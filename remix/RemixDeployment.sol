// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockCreditUSDC
 * @notice Mock 6-decimal USDC for testnet deployment (Sepolia, Base Sepolia, etc.).
 * Deploy this first if you are deploying to a testnet so that your CustomerCreditVault
 * has a token to accept deposits for credits.
 */
contract MockCreditUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {
        // Mint 10,000 USDC to deployer upon creation (6 decimals)
        _mint(msg.sender, 10_000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

/**
 * @title CustomerCreditVault
 * @notice Holds USDC and enforces customer available/reserved credit transitions.
 * @dev Non-upgradeable vault contract enforcing integer micro-USDC balance accounting.
 */
contract CustomerCreditVault is AccessControl, EIP712, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    IERC20 public immutable usdc;

    bytes32 public constant BILLING_ROLE = keccak256("BILLING_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant RESERVATION_TYPEHASH = keccak256(
        "Reservation(bytes32 reservationId,address customer,uint256 maximumCharge,uint48 expiresAt,bytes32 termsHash,uint256 chainId,address vault)"
    );

    enum ReservationStatus {
        None,
        Active,
        Finalized,
        Released
    }

    struct Reservation {
        address customer;
        uint256 maximumCharge;
        uint48 expiresAt;
        ReservationStatus status;
        uint256 finalCharge;
        bytes32 termsHash;
        uint256 grantGeneration;
    }

    struct SessionGrant {
        uint256 maxTotalCharge;
        uint256 spent;
        uint48 expiresAt;
    }

    mapping(address => uint256) public availableCreditOf;
    mapping(address => uint256) public reservedCreditOf;
    mapping(bytes32 => Reservation) public reservations;
    mapping(address => SessionGrant) public sessionGrantOf;
    mapping(address => uint256) public sessionGrantGeneration;

    uint256 public totalAvailableLiability;
    uint256 public totalReservedLiability;
    uint256 public unwithdrawnRevenue;

    error ZeroAddress();
    error ZeroAmount();
    error UnsupportedBaseUsdc(address token);
    error UnexpectedDepositAmount(uint256 requested, uint256 received);
    error InsufficientAvailableCredit(address customer, uint256 requested, uint256 available);
    error InsufficientReservedCredit(address customer, uint256 requested, uint256 reserved);
    error DuplicateReservationId(bytes32 reservationId);
    error InvalidReservationAuthorization(bytes32 reservationId, address customer);
    error ReservationNotFound(bytes32 reservationId);
    error ReservationExpired(bytes32 reservationId, uint48 expiresAt, uint256 currentTimestamp);
    error ReservationNotExpired(bytes32 reservationId, uint48 expiresAt, uint256 currentTimestamp);
    error ReservationAlreadyFinalized(bytes32 reservationId);
    error ExcessiveSettlement(bytes32 reservationId, uint256 requested, uint256 maximumCharge);
    error InsufficientRevenue(uint256 requested, uint256 unwithdrawnRevenue);
    error SessionGrantExpired(address customer, uint48 expiresAt, uint256 currentTimestamp);
    error SessionGrantExhausted(address customer, uint256 requested, uint256 remaining);
    error InvalidSessionGrant();

    event Deposited(address indexed customer, uint256 amount);
    event Withdrawn(address indexed customer, uint256 amount);
    event Reserved(
        bytes32 indexed reservationId,
        address indexed customer,
        uint256 maximumCharge,
        uint48 expiresAt,
        bytes32 termsHash
    );
    event Settled(bytes32 indexed reservationId, uint256 finalCharge, uint256 releasedAmount);
    event Released(bytes32 indexed reservationId, string reason);
    event RevenueWithdrawn(address indexed recipient, uint256 amount);
    event SessionGranted(address indexed customer, uint256 maxTotalCharge, uint48 expiresAt);
    event SessionGrantRevoked(address indexed customer, uint256 spent);

    constructor(address _usdc, address _admin, address _billing, address _treasury)
        EIP712("Leg Customer Credit Vault", "1")
    {
        if (_usdc == address(0) || _admin == address(0) || _billing == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        if (block.chainid == 8453 && _usdc != BASE_USDC) {
            revert UnsupportedBaseUsdc(_usdc);
        }

        usdc = IERC20(_usdc);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(BILLING_ROLE, _billing);
        _grantRole(TREASURY_ROLE, _treasury);
    }

    function totalCustomerLiability() public view returns (uint256) {
        return totalAvailableLiability + totalReservedLiability;
    }

    function reservationDigest(
        bytes32 reservationId,
        address customer,
        uint256 maximumCharge,
        uint48 expiresAt,
        bytes32 termsHash
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESERVATION_TYPEHASH,
                    reservationId,
                    customer,
                    maximumCharge,
                    expiresAt,
                    termsHash,
                    block.chainid,
                    address(this)
                )
            )
        );
    }

    function deposit(uint256 amount) public whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert UnexpectedDepositAmount(amount, received);

        availableCreditOf[msg.sender] += amount;
        totalAvailableLiability += amount;

        emit Deposited(msg.sender, amount);
    }

    function grantSession(uint256 maxTotalCharge, uint48 expiresAt) public whenNotPaused {
        if (maxTotalCharge == 0) revert ZeroAmount();
        if (expiresAt <= block.timestamp) {
            revert SessionGrantExpired(msg.sender, expiresAt, block.timestamp);
        }

        sessionGrantOf[msg.sender] =
            SessionGrant({maxTotalCharge: maxTotalCharge, spent: 0, expiresAt: expiresAt});
        sessionGrantGeneration[msg.sender] += 1;

        emit SessionGranted(msg.sender, maxTotalCharge, expiresAt);
    }

    function depositWithGrant(uint256 amount, uint256 maxTotalCharge, uint48 expiresAt)
        external
    {
        deposit(amount);
        grantSession(maxTotalCharge, expiresAt);
    }

    function revokeSessionGrant() external {
        SessionGrant memory grant = sessionGrantOf[msg.sender];
        if (grant.maxTotalCharge == 0) revert InvalidSessionGrant();

        delete sessionGrantOf[msg.sender];
        sessionGrantGeneration[msg.sender] += 1;

        emit SessionGrantRevoked(msg.sender, grant.spent);
    }

    function remainingSessionAllowance(address customer) public view returns (uint256) {
        SessionGrant memory grant = sessionGrantOf[customer];
        if (grant.maxTotalCharge == 0 || block.timestamp >= grant.expiresAt) return 0;
        return grant.maxTotalCharge - grant.spent;
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = availableCreditOf[msg.sender];
        if (amount > available) {
            revert InsufficientAvailableCredit(msg.sender, amount, available);
        }

        availableCreditOf[msg.sender] -= amount;
        totalAvailableLiability -= amount;

        emit Withdrawn(msg.sender, amount);

        usdc.safeTransfer(msg.sender, amount);
    }

    function reserve(
        bytes32 reservationId,
        address customer,
        uint256 maximumCharge,
        uint48 expiresAt,
        bytes32 termsHash,
        bytes calldata customerSignature
    ) external onlyRole(BILLING_ROLE) whenNotPaused nonReentrant {
        if (customer == address(0)) revert ZeroAddress();
        if (maximumCharge == 0) revert ZeroAmount();
        if (reservations[reservationId].status != ReservationStatus.None) {
            revert DuplicateReservationId(reservationId);
        }
        if (expiresAt <= block.timestamp) {
            revert ReservationExpired(reservationId, expiresAt, block.timestamp);
        }

        uint256 grantGeneration = 0;
        if (customerSignature.length == 0) {
            grantGeneration = _consumeSessionGrant(customer, maximumCharge);
        } else if (!SignatureChecker.isValidSignatureNow(
                customer,
                reservationDigest(reservationId, customer, maximumCharge, expiresAt, termsHash),
                customerSignature
            )) {
            revert InvalidReservationAuthorization(reservationId, customer);
        }

        uint256 available = availableCreditOf[customer];
        if (maximumCharge > available) {
            revert InsufficientAvailableCredit(customer, maximumCharge, available);
        }

        availableCreditOf[customer] -= maximumCharge;
        reservedCreditOf[customer] += maximumCharge;

        totalAvailableLiability -= maximumCharge;
        totalReservedLiability += maximumCharge;

        reservations[reservationId] = Reservation({
            customer: customer,
            maximumCharge: maximumCharge,
            expiresAt: expiresAt,
            status: ReservationStatus.Active,
            finalCharge: 0,
            termsHash: termsHash,
            grantGeneration: grantGeneration
        });

        emit Reserved(reservationId, customer, maximumCharge, expiresAt, termsHash);
    }

    function settle(bytes32 reservationId, uint256 finalCharge)
        external
        onlyRole(BILLING_ROLE)
        whenNotPaused
        nonReentrant
    {
        Reservation storage res = reservations[reservationId];
        if (res.status == ReservationStatus.None) {
            revert ReservationNotFound(reservationId);
        }
        if (res.status != ReservationStatus.Active) {
            revert ReservationAlreadyFinalized(reservationId);
        }
        if (block.timestamp >= res.expiresAt) {
            revert ReservationExpired(reservationId, res.expiresAt, block.timestamp);
        }
        if (finalCharge > res.maximumCharge) {
            revert ExcessiveSettlement(reservationId, finalCharge, res.maximumCharge);
        }

        res.status = ReservationStatus.Finalized;
        res.finalCharge = finalCharge;
        address customer = res.customer;
        uint256 maxCharge = res.maximumCharge;
        uint256 releasedAmount = maxCharge - finalCharge;

        reservedCreditOf[customer] -= maxCharge;
        totalReservedLiability -= maxCharge;

        if (releasedAmount > 0) {
            availableCreditOf[customer] += releasedAmount;
            totalAvailableLiability += releasedAmount;
        }

        if (finalCharge > 0) {
            unwithdrawnRevenue += finalCharge;
        }

        _refundSessionGrant(customer, releasedAmount, res.grantGeneration);

        emit Settled(reservationId, finalCharge, releasedAmount);
    }

    function release(bytes32 reservationId) external onlyRole(BILLING_ROLE) nonReentrant {
        _releaseReservation(reservationId, "release");
    }

    function expire(bytes32 reservationId) external nonReentrant {
        Reservation memory res = reservations[reservationId];
        if (res.status == ReservationStatus.None) {
            revert ReservationNotFound(reservationId);
        }
        if (block.timestamp < res.expiresAt) {
            revert ReservationNotExpired(reservationId, res.expiresAt, block.timestamp);
        }
        _releaseReservation(reservationId, "expired");
    }

    function _consumeSessionGrant(address customer, uint256 amount) internal returns (uint256) {
        SessionGrant storage grant = sessionGrantOf[customer];
        if (grant.maxTotalCharge == 0) revert InvalidSessionGrant();
        if (block.timestamp >= grant.expiresAt) {
            revert SessionGrantExpired(customer, grant.expiresAt, block.timestamp);
        }
        uint256 remaining = grant.maxTotalCharge - grant.spent;
        if (amount > remaining) {
            revert SessionGrantExhausted(customer, amount, remaining);
        }
        grant.spent += amount;
        return sessionGrantGeneration[customer];
    }

    function _refundSessionGrant(address customer, uint256 amount, uint256 generation) internal {
        if (amount == 0 || generation == 0) return;
        if (sessionGrantGeneration[customer] != generation) return;
        SessionGrant storage grant = sessionGrantOf[customer];
        if (grant.maxTotalCharge == 0) return;
        grant.spent = amount >= grant.spent ? 0 : grant.spent - amount;
    }

    function _releaseReservation(bytes32 reservationId, string memory reason) internal {
        Reservation storage res = reservations[reservationId];
        if (res.status == ReservationStatus.None) {
            revert ReservationNotFound(reservationId);
        }
        if (res.status != ReservationStatus.Active) {
            revert ReservationAlreadyFinalized(reservationId);
        }

        res.status = ReservationStatus.Released;
        address customer = res.customer;
        uint256 maxCharge = res.maximumCharge;

        reservedCreditOf[customer] -= maxCharge;
        totalReservedLiability -= maxCharge;

        availableCreditOf[customer] += maxCharge;
        totalAvailableLiability += maxCharge;

        _refundSessionGrant(customer, maxCharge, res.grantGeneration);

        emit Released(reservationId, reason);
    }

    function withdrawRevenue(address recipient, uint256 amount)
        external
        onlyRole(TREASURY_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > unwithdrawnRevenue) {
            revert InsufficientRevenue(amount, unwithdrawnRevenue);
        }

        unwithdrawnRevenue -= amount;

        emit RevenueWithdrawn(recipient, amount);

        usdc.safeTransfer(recipient, amount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}

/**
 * @title AgentWallet
 * @notice Lightweight smart wallet allowing owner or authorized agent to execute transactions.
 */
contract AgentWallet {
    address public owner;
    address public agent;

    event Executed(address indexed target, uint256 value, bytes data);

    modifier onlyAuthorized() {
        _onlyAuthorized();
        _;
    }

    function _onlyAuthorized() internal view {
        require(msg.sender == owner || msg.sender == agent, "unauthorized");
    }

    constructor(address _agent) {
        owner = msg.sender;
        agent = _agent;
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyAuthorized returns (bytes memory) {
        (bool ok, bytes memory result) = target.call{value: value}(data);
        require(ok, "call failed");
        emit Executed(target, value, data);
        return result;
    }

    receive() external payable {}
}

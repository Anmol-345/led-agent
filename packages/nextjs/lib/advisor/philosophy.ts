import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The published philosophy is Markdown so it can be reviewed and versioned as content, but the
 * advisor must be able to cite an exact principle. Headings therefore carry a machine-readable
 * `id -- Investor -- Title` triple that this loader parses and validates.
 */
export const ADVISOR_PHILOSOPHY_INVESTORS = [
  "Benjamin Graham",
  "Warren Buffett",
  "Charlie Munger",
  "Peter Lynch",
  "John Templeton",
  "Joel Greenblatt",
  "Walter Schloss",
] as const;

export type AdvisorPhilosophyInvestor = (typeof ADVISOR_PHILOSOPHY_INVESTORS)[number];

export type AdvisorPhilosophyPrinciple = {
  id: string;
  investor: AdvisorPhilosophyInvestor;
  title: string;
  summary: string;
};

export type AdvisorPhilosophy = {
  version: string;
  principles: readonly AdvisorPhilosophyPrinciple[];
  limitations: readonly string[];
};

const philosophyVersionPattern = /^v[1-9][0-9]*$/;
const principleIdPattern = /^[a-z][a-z0-9-]*$/;
const principlesHeading = "## Principles";
const limitationsHeading = "## Research Limitations";

function isPhilosophyInvestor(value: string): value is AdvisorPhilosophyInvestor {
  return ADVISOR_PHILOSOPHY_INVESTORS.some(investor => investor === value);
}

function validatedPhilosophyVersion(version: string): string {
  if (!philosophyVersionPattern.test(version)) {
    throw new Error("Advisor philosophy version must be published as v1, v2, and so on.");
  }
  return version;
}

function philosophyMarkdown(version: string): string {
  const path = fileURLToPath(
    new URL(`../../content/advisor-philosophy/${version}.md`, import.meta.url),
  );
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`Advisor philosophy ${version} is not published.`);
  }
}

function sectionBody(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start === -1) {
    throw new Error(`Advisor philosophy is missing its ${heading} section.`);
  }
  const bodyStart = start + heading.length + 2;
  const end = markdown.indexOf("\n## ", bodyStart);
  return end === -1 ? markdown.slice(bodyStart) : markdown.slice(bodyStart, end);
}

function parsedPrinciples(markdown: string): AdvisorPhilosophyPrinciple[] {
  const principles: AdvisorPhilosophyPrinciple[] = [];

  for (const block of sectionBody(markdown, principlesHeading).split("\n### ").slice(1)) {
    const newline = block.indexOf("\n");
    const [id, investor, title] = block
      .slice(0, newline === -1 ? block.length : newline)
      .split(" -- ")
      .map(part => part.trim());
    const summary = newline === -1 ? "" : block.slice(newline + 1).trim();

    if (!id || !investor || !title || !summary || !principleIdPattern.test(id)) {
      throw new Error(
        "Advisor philosophy principles must use a `### id -- Investor -- Title` heading and a summary.",
      );
    }
    if (!isPhilosophyInvestor(investor)) {
      throw new Error(`Advisor philosophy names an unpublished investor: ${investor}.`);
    }
    principles.push({ id, investor, summary, title });
  }

  return principles;
}

function parsedLimitations(markdown: string): string[] {
  return sectionBody(markdown, limitationsHeading)
    .split("\n- ")
    .slice(1)
    .map(limitation => limitation.replace(/\s+/g, " ").trim())
    .filter(limitation => limitation.length > 0);
}

function assertCompletePhilosophy(philosophy: AdvisorPhilosophy): void {
  const investors = new Set(philosophy.principles.map(principle => principle.investor));
  for (const investor of ADVISOR_PHILOSOPHY_INVESTORS) {
    if (!investors.has(investor)) {
      throw new Error(`Advisor philosophy ${philosophy.version} is missing ${investor}.`);
    }
  }

  const identifiers = new Set(philosophy.principles.map(principle => principle.id));
  if (identifiers.size !== philosophy.principles.length) {
    throw new Error(`Advisor philosophy ${philosophy.version} repeats a principle identifier.`);
  }

  if (philosophy.limitations.length === 0) {
    throw new Error(`Advisor philosophy ${philosophy.version} publishes no research limitation.`);
  }
}

const loadedPhilosophies = new Map<string, AdvisorPhilosophy>();

export function loadAdvisorPhilosophy(version: string): AdvisorPhilosophy {
  const philosophyVersion = validatedPhilosophyVersion(version);
  const cached = loadedPhilosophies.get(philosophyVersion);
  if (cached) return cached;

  const markdown = philosophyMarkdown(philosophyVersion);
  const philosophy: AdvisorPhilosophy = {
    limitations: parsedLimitations(markdown),
    principles: parsedPrinciples(markdown),
    version: philosophyVersion,
  };
  assertCompletePhilosophy(philosophy);

  loadedPhilosophies.set(philosophyVersion, philosophy);
  return philosophy;
}

export function findPhilosophyPrinciple(
  philosophy: AdvisorPhilosophy,
  principleId: string,
): AdvisorPhilosophyPrinciple | undefined {
  return philosophy.principles.find(principle => principle.id === principleId);
}

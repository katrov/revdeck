export interface QualityMetrics {
    project: string;
    from: string;
    to: string;
    generatedAt: string;
    reviews: { total: number; open: number; merged: number; closed: number };
    findings: {
        total: number;
        accepted: number;
        rejected: number;
        discussed: number;
        pending: number;
        published: number;
        withRule: number;
    };
    rates: {
        acceptance: number | null;
        publish: number | null;
        ruleGrounded: number | null;
    };
    coverage: { reviewsWithCoverage: number; reviewsWithUnknowns: number; coverageItems: number; unknownItems: number };
    process: { duplicates: number; ruleCandidates: number };
    timing: { reviewsWithFirstFinding: number; medianTimeToFirstFindingMs: number | null; medianCycleTimeMs: number | null };
    activity: {
        findingsDrafted: number;
        summariesSaved: number;
        decisionsSaved: number;
        publishes: number;
        checks: number;
    };
    actors: { human: number; agent: number; system: number };
    events: number;
}

export type KnockoutDrawSlot = {
  id: string | null;
  label: string;
  group: number | null;
  rank: number | null;
};

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function crossGroupMatching(
  left: KnockoutDrawSlot[],
  right: KnockoutDrawSlot[],
  random: () => number,
): Array<[KnockoutDrawSlot, KnockoutDrawSlot]> | null {
  if (left.length !== right.length) return null;
  const candidates = shuffled(right, random);
  const result: Array<[KnockoutDrawSlot, KnockoutDrawSlot]> = [];
  const search = (index: number, remaining: KnockoutDrawSlot[]): boolean => {
    if (index === left.length) return true;
    const options = shuffled(
      remaining.filter((candidate) => left[index].group !== candidate.group),
      random,
    );
    for (const candidate of options) {
      if (
        search(
          index + 1,
          remaining.filter((item) => item !== candidate),
        )
      ) {
        result.unshift([left[index], candidate]);
        return true;
      }
    }
    return false;
  };
  return search(0, candidates) ? result : null;
}

function pairSameRankAcrossGroups(
  slots: KnockoutDrawSlot[],
  random: () => number,
): { pairs: Array<[KnockoutDrawSlot, KnockoutDrawSlot]>; remaining: KnockoutDrawSlot[] } {
  const remaining = shuffled(slots, random);
  const pairs: Array<[KnockoutDrawSlot, KnockoutDrawSlot]> = [];
  while (remaining.length > 1) {
    const first = remaining.shift()!;
    const index = remaining.findIndex((candidate) => candidate.group !== first.group);
    if (index < 0) {
      remaining.unshift(first);
      break;
    }
    const [second] = remaining.splice(index, 1);
    pairs.push([first, second]);
  }
  return { pairs, remaining };
}

/**
 * Creates first-round pairings. With group promotion, ranks are paired from
 * opposite ends (1 vs last, 2 vs second-last) and same-group pairings are
 * prohibited whenever a cross-group draw is possible. Later rounds are not
 * affected by these constraints.
 */
export function pairKnockoutFirstRound(options: {
  slots: KnockoutDrawSlot[];
  roundRobinEnabled: boolean;
  promotedPerGroup: number;
  random?: () => number;
}): Array<[KnockoutDrawSlot, KnockoutDrawSlot]> {
  const { slots, roundRobinEnabled, promotedPerGroup, random = Math.random } = options;
  const remaining = [...slots];
  const pairs: Array<[KnockoutDrawSlot, KnockoutDrawSlot]> = [];
  const realSlots = remaining.filter((slot) => slot.label !== 'Bye');
  const groups = new Set(realSlots.map((slot) => slot.group).filter((group) => group != null));

  if (roundRobinEnabled && groups.size > 1) {
    const promoted = Math.max(1, promotedPerGroup);
    for (let rank = 1; rank <= Math.floor(promoted / 2); rank += 1) {
      const oppositeRank = promoted + 1 - rank;
      const left = remaining.filter((slot) => slot.label !== 'Bye' && slot.rank === rank);
      const right = remaining.filter((slot) => slot.label !== 'Bye' && slot.rank === oppositeRank);
      const matched = crossGroupMatching(left, right, random);
      if (matched) {
        for (const pair of matched) {
          pairs.push(pair);
          for (const slot of pair) remaining.splice(remaining.indexOf(slot), 1);
        }
      }
    }

    if (promoted % 2 === 1) {
      const middle = remaining.filter(
        (slot) => slot.label !== 'Bye' && slot.rank === (promoted + 1) / 2,
      );
      const matched = pairSameRankAcrossGroups(middle, random);
      for (const pair of matched.pairs) {
        pairs.push(pair);
        for (const slot of pair) remaining.splice(remaining.indexOf(slot), 1);
      }
    }

    // For irregular group sizes, pair any remaining entries across groups first.
    const leftovers = shuffled(
      remaining.filter((slot) => slot.label !== 'Bye'),
      random,
    );
    while (leftovers.length > 1) {
      const first = leftovers.shift()!;
      const index = leftovers.findIndex((candidate) => candidate.group !== first.group);
      if (index < 0) {
        leftovers.unshift(first);
        break;
      }
      const [second] = leftovers.splice(index, 1);
      pairs.push([first, second]);
      remaining.splice(remaining.indexOf(first), 1);
      remaining.splice(remaining.indexOf(second), 1);
    }
  }

  // Pair any unpaired entries, prioritizing cross-group pairings when possible.
  const rest = shuffled(remaining, random);
  while (rest.length >= 2) {
    const first = rest.shift()!;
    let index = rest.findIndex(
      (candidate) =>
        first.label === 'Bye' || candidate.label === 'Bye' || first.group !== candidate.group,
    );
    if (index < 0) index = 0;
    const [second] = rest.splice(index, 1);
    pairs.push([first, second]);
  }
  if (rest.length) throw new Error('Knockout draw slots must be an even number.');

  // Avoid bye-vs-bye matches whenever another match has two real entrants.
  for (let index = 0; index < pairs.length; index += 1) {
    const current = pairs[index];
    if (current[0].label !== 'Bye' || current[1].label !== 'Bye') continue;
    const donorIndex = pairs.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex !== index && candidate[0].label !== 'Bye' && candidate[1].label !== 'Bye',
    );
    if (donorIndex < 0) continue;
    const donor = pairs[donorIndex];
    pairs[index] = [donor[0], current[1]];
    pairs[donorIndex] = [current[0], donor[1]];
  }
  return shuffled(pairs, random);
}

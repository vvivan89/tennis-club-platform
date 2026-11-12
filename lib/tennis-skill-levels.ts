export function getTennisSkillLevels(minSkill = 2.5, maxSkill = 7.0): string[] {
  if (!Number.isFinite(minSkill) || minSkill < 0 || minSkill > 6.5) {
    throw new RangeError('Minimum tennis skill must be between 0.0 and 6.5.');
  }
  if (!Number.isFinite(maxSkill) || maxSkill < 0.5 || maxSkill > 7.0) {
    throw new RangeError('Maximum tennis skill must be between 0.5 and 7.0.');
  }
  if (maxSkill < minSkill) {
    throw new RangeError('Maximum tennis skill cannot be less than minimum tennis skill.');
  }

  const steps = Math.floor((maxSkill - minSkill + Number.EPSILON) / 0.5);
  return Array.from({ length: steps + 1 }, (_, index) => (minSkill + index * 0.5).toFixed(1));
}

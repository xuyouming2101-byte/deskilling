export function isStudyParticipantId(participantId: string) {
  return /^P(?:0[1-9]|[1-9][0-9]|100)$/.test(participantId);
}

export function participantPassword(participantId: string) {
  return `deskilling${participantId}`;
}

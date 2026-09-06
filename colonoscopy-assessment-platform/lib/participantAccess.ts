export function isStudyParticipantId(participantId: string) {
  return /^P(?:0[1-9]|[1-5][0-9]|60)$/.test(participantId);
}

export function participantPassword(participantId: string) {
  return `deskilling${participantId}`;
}

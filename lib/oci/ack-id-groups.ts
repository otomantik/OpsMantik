export type AckIdGroups = {
  sealIds: string[];
  signalIds: string[];
  pvIds: string[];
  projIds: string[];
  adjIds: string[];
  unknownIds: string[];
};

export function splitAckPrefixedIds(ids: string[]): AckIdGroups {
  const out: AckIdGroups = {
    sealIds: [],
    signalIds: [],
    pvIds: [],
    projIds: [],
    adjIds: [],
    unknownIds: [],
  };

  for (const id of ids) {
    const s = String(id);
    if (s.startsWith('seal_')) out.sealIds.push(s.slice(5));
    else if (s.startsWith('signal_')) out.signalIds.push(s.slice(7));
    else if (s.startsWith('pv_')) out.pvIds.push(s.slice(3));
    else if (s.startsWith('proj_')) out.projIds.push(s.slice(5));
    else if (s.startsWith('adj_')) out.adjIds.push(s.slice(4));
    else out.unknownIds.push(s);
  }

  return out;
}

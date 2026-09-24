/**
 * Colors aligned with OP25 terminal display (boatbod / smartColors):
 * Fire -> Coral / Fire Red (#f87171 / #ff5252)
 * AMR / EMS -> Warm Amber / Gold (#fbbf24 / #ffa000)
 * DPS / Police / Law -> High-contrast Silver / Ice (#e2e8f0 / #93c5fd)
 * Tactical / Other -> Electric Cyan (#22d3ee)
 */
export function getTalkgroupColor(tag?: string | null): string {
  if (!tag) return '#e2e8f0';
  const lower = tag.toLowerCase();

  if (lower.includes('fire') || lower.includes('mcf') || lower.includes('rescue')) {
    return '#f87171'; // Coral Red (like MC Fire Disp in OP25)
  }
  if (lower.includes('amr') || lower.includes('ems') || lower.includes('medic')) {
    return '#fbbf24'; // Golden Amber (like MC AMR Disp in OP25)
  }
  if (lower.includes('dps') || lower.includes('police') || lower.includes('ppb') || lower.includes('sheriff')) {
    return '#f1f5f9'; // High-contrast White/Silver (like PCC DPS Disp in OP25)
  }
  if (lower.includes('tac')) {
    return '#38bdf8'; // Tactical Ice Blue
  }
  return '#22d3ee'; // Default Cyan
}

/**
 * Deterministic color palette for multiple systems/stations.
 * Allows quick visual distinction between station 1, station 2, or multiple trunked networks.
 */
const SYSTEM_PALETTE = [
  '#22d3ee', // Cyan
  '#a78bfa', // Lavender / Violet
  '#34d399', // Emerald
  '#fbbf24', // Amber
  '#38bdf8', // Sky Blue
  '#f472b6', // Pink
  '#fb923c', // Orange
];

export function getSystemColor(sysStr?: string | null): string {
  if (!sysStr) return '#94a3b8';
  let hash = 0;
  for (let i = 0; i < sysStr.length; i++) {
    hash = (hash << 5) - hash + sysStr.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % SYSTEM_PALETTE.length;
  return SYSTEM_PALETTE[idx];
}

/**
 * Cleanly format system or station names to 3-5 characters to fit tabular column.
 * - Extracts 3-4 hex digits if present (e.g. 0x3cc -> 3CC)
 * - Converts multi-word names (e.g. Portland P25 -> 3CC or PTLD)
 * - Passes short station codes (ST01, STA2) directly
 */
export function formatSystemLabel(sysStr?: string | null, fallback = '3CC'): string {
  if (!sysStr) return fallback;
  const clean = sysStr.trim();

  // Known common aliases
  if (/portland/i.test(clean)) return '3CC';

  // 3-4 digit hex sysid match (e.g., "0x3cc", "sysid 3CC", "3CC")
  const hexMatch = clean.match(/(?:0x)?\b([0-9A-Fa-f]{3,4})\b/);
  if (hexMatch) return hexMatch[1].toUpperCase();

  // Short codes (e.g. "ST1", "STA", "3CC")
  if (clean.length <= 4) return clean.toUpperCase();

  // Multi-word strings: try acronym or first word abbreviation
  const words = clean.split(/[\s\-_]+/);
  if (words.length >= 2) {
    const acronym = words.map(w => w[0]).join('').toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 4) return acronym;
  }

  return clean.slice(0, 4).toUpperCase();
}

export interface CategoryMeta {
  label: string;
  fullLabel: string;
  color: string;
}

export function getTalkgroupCategory(
  alias?: string | null,
  group?: string | null,
  category?: string | null
): CategoryMeta {
  const customStr = (group && group.trim()) || (category && category.trim()) || '';
  const checkStr = (customStr || alias || '').toLowerCase();

  if (checkStr.includes('fire') || checkStr.includes('mcf') || checkStr.includes('rescue')) {
    return { label: 'FIRE', fullLabel: customStr || 'Fire / Rescue', color: '#f87171' };
  }
  if (checkStr.includes('amr') || checkStr.includes('ems') || checkStr.includes('medic') || checkStr.includes('ambulance')) {
    return { label: 'EMS', fullLabel: customStr || 'EMS / Medical', color: '#fbbf24' };
  }
  if (checkStr.includes('dps') || checkStr.includes('police') || checkStr.includes('ppb') || checkStr.includes('sheriff') || checkStr.includes('law')) {
    return { label: 'LAW', fullLabel: customStr || 'Law Enforcement', color: '#f1f5f9' };
  }
  if (checkStr.includes('tac')) {
    return { label: 'TAC', fullLabel: customStr || 'Tactical Ops', color: '#38bdf8' };
  }
  if (checkStr.includes('pw') || checkStr.includes('transit') || checkStr.includes('util') || checkStr.includes('public works')) {
    return { label: 'PUB', fullLabel: customStr || 'Public Works', color: '#34d399' };
  }
  if (checkStr.includes('disp') || checkStr.includes('dispatch')) {
    return { label: 'DISP', fullLabel: customStr || 'Dispatch', color: '#22d3ee' };
  }
  return { label: 'GEN', fullLabel: customStr || 'General', color: '#94a3b8' };
}




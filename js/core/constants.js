export const DEFAULT_ELO = 900;

export const CIVS = [
  { id: "p1", name: "P1 Dol Guldur", side: "evil", teamid: 5 },
  { id: "p2", name: "P2 Dol Guldur", side: "evil", teamid: 6 },
  { id: "p3", name: "P3 Azog's Host", side: "evil", teamid: 7 },
  { id: "p4", name: "P4 Goblin", side: "evil", teamid: 8 },
  { id: "p5", name: "P5 Blue Mountains", side: "good", teamid: 9 },
  { id: "p6", name: "P6 Northmen", side: "good", teamid: 10 },
  { id: "p7", name: "P7 Elves", side: "good", teamid: 11 },
  { id: "p8", name: "P8 Iron Hills", side: "good", teamid: 12 },
];

export const EVIL_CIVS = CIVS.filter(c => c.side === "evil");
export const GOOD_CIVS = CIVS.filter(c => c.side === "good");

export const TEAMID_MAP = Object.fromEntries(CIVS.map(c => [c.teamid, c.id]));
export const RACE_MAP = { 4:"p1", 38:"p2", 17:"p3", 25:"p4", 12:"p5", 32:"p6", 9:"p7", 22:"p8" };

export const LOTR_KEYWORDS = ["hobbit", "lotr", "lord of the ring", "the shire", "middle earth"];
export const LOTR_MAPS = ["the_hobbit", "hobbit", "lotr"];

export const CIV_NAME_MAP = {
  "P5 Blue Mts": "P5 Blue Mountains",
  "Blue Mts": "Blue Mountains",
};

export function normalizeCivName(name) {
  return CIV_NAME_MAP[name] || name;
}

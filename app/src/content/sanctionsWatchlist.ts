/**
 * Sample sanctions/PEP watchlist for the demo screening engine. In production
 * this would be replaced by live OFAC SDN, EU consolidated, UN, and PEP list
 * feeds. Names here are illustrative placeholders - a screened holder whose name
 * contains one of these is returned as a sanctions hit.
 */
export const SANCTIONS_WATCHLIST: string[] = [
  'OFAC SDN Sample',
  'Blocked Person',
  'Sanctioned Entity',
  'Restricted Party',
]

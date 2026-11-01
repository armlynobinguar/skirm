// The ten official v2 maps (spec/maps/v2, written by scripts/export-v2-maps.ts), in atlas order.
import saltmarshWeir from '../../../../spec/maps/v2/saltmarsh-weir.json' with { type: 'json' };
import ashfallOrchard from '../../../../spec/maps/v2/ashfall-orchard.json' with { type: 'json' };
import frostlineDepot from '../../../../spec/maps/v2/frostline-depot.json' with { type: 'json' };
import glasshouseRuins from '../../../../spec/maps/v2/glasshouse-ruins.json' with { type: 'json' };
import copperHollow from '../../../../spec/maps/v2/copper-hollow.json' with { type: 'json' };
import dustBowlSilos from '../../../../spec/maps/v2/dust-bowl-silos.json' with { type: 'json' };
import monsoonTerraces from '../../../../spec/maps/v2/monsoon-terraces.json' with { type: 'json' };
import sunkenMetro from '../../../../spec/maps/v2/sunken-metro.json' with { type: 'json' };
import basaltStair from '../../../../spec/maps/v2/basalt-stair.json' with { type: 'json' };
import blackoutHarbor from '../../../../spec/maps/v2/blackout-harbor.json' with { type: 'json' };
import type { MapDefV2 } from './map';

export const MAPS_V2: readonly MapDefV2[] = [
  saltmarshWeir,
  ashfallOrchard,
  frostlineDepot,
  glasshouseRuins,
  copperHollow,
  dustBowlSilos,
  monsoonTerraces,
  sunkenMetro,
  basaltStair,
  blackoutHarbor,
] as unknown as MapDefV2[];

/** Today's ranked rotation map. */
export const ROTATION_MAP_ID = 'copper-hollow';

export function mapV2(id: string): MapDefV2 | undefined {
  return MAPS_V2.find((m) => m.id === id);
}

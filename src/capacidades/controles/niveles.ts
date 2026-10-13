import type { EmpresaId, SucursalId } from "../../primitivas/identificadores/marca";
import type { ClaveDeControl } from "./catalogo";
import type { NivelDeControl } from "./nivel";

/**
 * Puerto `NivelesDeControl` (registro de contratos, K5/ADR-008): el nivel que rige un control en este
 * momento. Lo implementa `adaptadores/postgres` leyendo `nivel_de_control` (0007) dentro de la
 * transacción del llamador, sin caché: un cambio de nivel confirmado un instante antes ya rige. Lo
 * declara `capacidades/controles` y no `puertos/` porque `capacidades` no importa `puertos` (ADR-001).
 *
 * `disponibleEnElPlan` lo informa quien llama (la perilla del control en los derechos de uso de la
 * empresa): con `false`, rige `PERMITIR` sin mirar los niveles. Obligatorio a propósito: un llamador
 * que se olvida del plan no compila. La sucursal puede endurecer el nivel de la empresa, no aflojarlo
 * (`resolverNivel`). Sin `sucursalId`, rige el de la empresa.
 */
export interface NivelesDeControl<C extends string = ClaveDeControl> {
  nivel(
    control: C,
    alcance: Readonly<{ empresaId: EmpresaId; sucursalId: SucursalId | null }>,
    disponibleEnElPlan: boolean,
  ): Promise<NivelDeControl>;
}

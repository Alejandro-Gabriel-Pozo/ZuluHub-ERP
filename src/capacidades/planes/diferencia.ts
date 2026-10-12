import type { EmpresaId, TenantId } from "../../primitivas/identificadores/marca";
import { clavesDe, estadoDeModulos } from "../modulos/activos";
import type { DefinicionDeModulo } from "../modulos/catalogo";
import {
  aplicarRequiere,
  modulosHabilitadosPor,
  valorDePerilla,
  valoresDelPlan,
  type AjusteDePerilla,
  type VersionDePlanVigente,
} from "./derechos";
import type { DefinicionDePerilla } from "./perillas";
import { vigenteEn } from "./vigencia";
import { esValorDeLaPerilla, type ValorDePerilla, type ValorEfectivo } from "./valores";

/**
 * Diferencia entre dos versiones de plan (marcas y planes, §B.5.7, N2): lo que la plataforma mira
 * antes de migrar a mano a uno o a varios tenants. Pura sobre datos de plataforma: no ve el uso
 * operativo («3 de 2» lo ve el gerente en «Plan y módulos»).
 *
 * Coincide con aplicar una y otra versión a `derechosDeUso` (incluido `requiere`): los módulos y los
 * valores se calculan con las mismas piezas, no con una copia de las reglas.
 */

export type SentidoDeCambio = "SUBE" | "BAJA";

export type CambioDePerilla<P extends string> = Readonly<{
  perilla: P;
  desde: ValorDePerilla;
  hasta: ValorDePerilla;
  sentido: SentidoDeCambio;
}>;

/** Un ajuste por cliente vigente (el extra que sobrevive al cambio de plan, decisión D-M3). */
export type AjusteQueSobrevive<P extends string> = Readonly<{
  perilla: P;
  /** `null`: el ajuste es de todo el tenant. */
  empresaId: EmpresaId | null;
  valor: ValorDePerilla;
  /** Lo que el plan dice de esa perilla en cada versión. */
  enDesde: ValorDePerilla;
  enHasta: ValorDePerilla;
  /** El plan cambia esa perilla entre las dos versiones, pero el ajuste sigue mandando. */
  pisaUnCambio: boolean;
}>;

export type ModuloEnSoloLectura = Readonly<{
  empresaId: EmpresaId;
  modulo: string;
  /** Ya estaba en solo lectura con la versión de origen (una baja anterior). */
  yaLoEstaba: boolean;
}>;

export type DiferenciaPorTenant<P extends string> = Readonly<{
  tenantId: TenantId;
  ajustes: readonly AjusteQueSobrevive<P>[];
  /** Módulos activados que quedarían en solo lectura con la versión de destino. */
  modulosEnSoloLectura: readonly ModuloEnSoloLectura[];
  /** Módulos en solo lectura con la versión de origen que volverían a operar con la de destino. */
  modulosQueVuelvenAOperar: readonly Readonly<{ empresaId: EmpresaId; modulo: string }>[];
}>;

export type DiferenciaEntreVersiones<M extends string, P extends string> = Readonly<{
  modulosQueEntran: readonly M[];
  modulosQueSalen: readonly M[];
  perillas: readonly CambioDePerilla<P>[];
  porTenant: readonly DiferenciaPorTenant<P>[];
}>;

export type TenantParaLaDiferencia = Readonly<{
  tenantId: TenantId;
  /** El historial de ajustes del tenant (todas sus empresas), en cualquier orden. */
  ajustes: readonly AjusteDePerilla[];
  /** Las empresas del tenant con los módulos que tienen activados. */
  empresas: readonly Readonly<{ empresaId: EmpresaId; modulosActivados: readonly string[] }>[];
}>;

/** Lo único que importa de una versión para compararla. */
export type ContenidoParaComparar = Pick<VersionDePlanVigente, "modulos" | "perillas">;

/** Cuánto vale un valor para ordenarlo: interruptor apagado 0, encendido 1; límite el número, sin tope infinito. */
function magnitud(valor: ValorDePerilla): number {
  if (valor.tipo === "INTERRUPTOR") return valor.encendida ? 1 : 0;
  return valor.limite === "ILIMITADO" ? Number.POSITIVE_INFINITY : valor.limite;
}

/**
 * La diferencia entre la versión `desde` y la `hasta`, al instante `ahora`. Los módulos y las perillas
 * salen en el orden de sus catálogos. Un tenant sin ajustes ni módulos activados igual figura (con
 * listas vacías) para que la consola muestre uno por uno al lote elegido.
 */
export function diferenciaEntreVersiones<M extends string, P extends string>(
  e: Readonly<{
    catalogoDeModulos: Readonly<Record<M, Pick<DefinicionDeModulo, "estado" | "obligatorio">>>;
    catalogoDePerillas: Readonly<Record<P, DefinicionDePerilla>>;
    desde: ContenidoParaComparar;
    hasta: ContenidoParaComparar;
    tenants: readonly TenantParaLaDiferencia[];
    ahora: Date;
  }>,
): DiferenciaEntreVersiones<M, P> {
  const modulosDesde = modulosHabilitadosPor(e.catalogoDeModulos, e.desde);
  const modulosHasta = modulosHabilitadosPor(e.catalogoDeModulos, e.hasta);
  const claves = clavesDe(e.catalogoDeModulos);

  const valoresDesde = aplicarRequiere(
    e.catalogoDePerillas,
    valoresDelPlan(e.catalogoDePerillas, e.desde.perillas),
  );
  const valoresHasta = aplicarRequiere(
    e.catalogoDePerillas,
    valoresDelPlan(e.catalogoDePerillas, e.hasta.perillas),
  );
  const perillas: CambioDePerilla<P>[] = [];
  for (const [perilla, desde] of valoresDesde) {
    const hasta = valorDePerilla({ perillas: valoresHasta }, perilla);
    const antes = magnitud(desde);
    const despues = magnitud(hasta);
    const sentido = despues > antes ? "SUBE" : despues < antes ? "BAJA" : null;
    if (sentido === null) continue;
    perillas.push({ perilla, desde: sinOrigen(desde), hasta: sinOrigen(hasta), sentido });
  }

  const habilitadosDesde = [...modulosDesde];
  const habilitadosHasta = [...modulosHasta];
  return {
    modulosQueEntran: claves.filter((m) => modulosHasta.has(m) && !modulosDesde.has(m)),
    modulosQueSalen: claves.filter((m) => modulosDesde.has(m) && !modulosHasta.has(m)),
    perillas,
    porTenant: e.tenants.map((tenant) => {
      const modulosEnSoloLectura: ModuloEnSoloLectura[] = [];
      const modulosQueVuelvenAOperar: { empresaId: EmpresaId; modulo: string }[] = [];
      for (const empresa of tenant.empresas) {
        const antes = estadoDeModulos(
          e.catalogoDeModulos,
          empresa.modulosActivados,
          habilitadosDesde,
        );
        const despues = estadoDeModulos(
          e.catalogoDeModulos,
          empresa.modulosActivados,
          habilitadosHasta,
        );
        for (const modulo of claves) {
          if (despues.modulosEnSoloLectura.has(modulo)) {
            modulosEnSoloLectura.push({
              empresaId: empresa.empresaId,
              modulo,
              yaLoEstaba: antes.modulosEnSoloLectura.has(modulo),
            });
          } else if (antes.modulosEnSoloLectura.has(modulo) && despues.modulosActivos.has(modulo)) {
            modulosQueVuelvenAOperar.push({ empresaId: empresa.empresaId, modulo });
          }
        }
      }
      return {
        tenantId: tenant.tenantId,
        ajustes: ajustesQueSobreviven(
          e.catalogoDePerillas,
          tenant.ajustes,
          e.ahora,
          valoresDesde,
          valoresHasta,
        ),
        modulosEnSoloLectura,
        modulosQueVuelvenAOperar,
      };
    }),
  };
}

/** El valor sin su origen (acá no importa de dónde salió). */
function sinOrigen(valor: ValorDePerilla): ValorDePerilla {
  return valor.tipo === "INTERRUPTOR"
    ? { tipo: "INTERRUPTOR", encendida: valor.encendida }
    : { tipo: "LIMITE", limite: valor.limite };
}

/**
 * Los ajustes vigentes con valor propio de un tenant (`DEL_PLAN` no pisa nada), por perilla y por
 * alcance (tenant o empresa), en el orden del catálogo y con el tenant antes que sus empresas.
 */
function ajustesQueSobreviven<P extends string>(
  catalogo: Readonly<Record<P, DefinicionDePerilla>>,
  ajustes: readonly AjusteDePerilla[],
  ahora: Date,
  valoresDesde: ReadonlyMap<P, ValorEfectivo>,
  valoresHasta: ReadonlyMap<P, ValorEfectivo>,
): AjusteQueSobrevive<P>[] {
  const resultado: AjusteQueSobrevive<P>[] = [];
  for (const perilla of clavesDe(catalogo)) {
    const enDesde = valorDePerilla({ perillas: valoresDesde }, perilla);
    const enHasta = valorDePerilla({ perillas: valoresHasta }, perilla);
    const deLaPerilla = ajustes.filter((a) => a.perilla === perilla);
    const empresas = new Set<EmpresaId>();
    for (const a of deLaPerilla) if (a.empresaId !== null) empresas.add(a.empresaId);
    const alcances: (EmpresaId | null)[] = [null, ...[...empresas].sort()];
    for (const empresaId of alcances) {
      const rige = vigenteEn(
        deLaPerilla.filter((a) => a.empresaId === empresaId),
        ahora,
      );
      // `DEL_PLAN` no es un valor de la perilla: no pisa nada. Tampoco un valor de otro tipo.
      if (rige === null || !esValorDeLaPerilla(catalogo[perilla], rige.valor)) continue;
      resultado.push({
        perilla,
        empresaId,
        valor: rige.valor,
        enDesde: sinOrigen(enDesde),
        enHasta: sinOrigen(enHasta),
        pisaUnCambio: magnitud(enDesde) !== magnitud(enHasta),
      });
    }
  }
  return resultado;
}

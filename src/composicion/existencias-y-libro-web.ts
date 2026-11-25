import { z } from "zod";
import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type {
  CursorDeMovimientosDeDeposito,
  PaginaDeExistencias,
  PaginaDeMovimientosDeDeposito,
} from "../modulos/stock/publico";
import type { personaId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * «Existencias» y «Movimientos» de stock (STK-B1, maqueta `stock.html` aprobada el 09/11/2026): dos LECTURAS del depósito elegido de la sucursal elegida. No escriben ni auditan, y repetirlas da lo mismo.
 *  - **La sucursal la pone el servidor** (nunca el pedido). El depósito se elige entre los de esa sucursal (los que la persona puede ver): uno que no es de la sucursal o no existe sale como el genérico,
 *    indistinguible. Sin depósito pedido, el primero de la lista (el servidor ya los ordena); nunca «todos».
 *  - **Sin costos ni «Disponible»**: la existencia sale como texto decimal exacto en la unidad de stock (ADR-006, nunca `number`); «Negativa» es solo el signo del texto.
 *  - **Quién registró**: los ids de persona NO salen; va el correo (`personasParaMostrar`, una sola vez por página). Si identidad no deja ver a las personas (permiso), la tarjeta sale igual con el correo en `null`
 *    y no se inventa un nombre; cualquier otro fallo no se esconde.
 *  - **Paginación por cursor opaco** (`despues`): lo codifica y lo valida esta capa; uno roto sale como el genérico (nada se adivina). Los instantes salen en ISO UTC (la pantalla los muestra en hora de Argentina).
 */

export type DependenciasDeExistenciasYLibroWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeStock"]>,
    "existencias" | "movimientosDelDeposito" | "listarDepositos"
  >;
  consultasDeIdentidad: () => Pick<ReturnType<Web["consultasDeIdentidad"]>, "personasParaMostrar">;
  respuesta: DependenciasDeRespuesta;
}>;

export type DepositoParaElSelector = Readonly<{ id: string; nombre: string }>;

export type ExistenciaParaLaPantalla = Readonly<{
  articuloId: string;
  nombre: string;
  unidadId: string;
  /** Texto decimal exacto, con signo si es negativa. */
  existencia: string;
  negativa: boolean;
}>;

export type ExistenciasParaLaPantalla = Readonly<{
  depositos: readonly DepositoParaElSelector[];
  depositoId: string | null;
  existencias: readonly ExistenciaParaLaPantalla[];
  /** Pasar como `despues` para pedir la página siguiente; `null` si no hay más. */
  siguiente: string | null;
}>;

export type MovimientoParaLaPantalla = Readonly<{
  movimientoId: string;
  numero: number;
  clase: string;
  motivo: string;
  hechoEn: string;
  /** Correo de quien lo registró; `null` si identidad no deja verlo. */
  quien: string | null;
  articuloId: string;
  nombre: string;
  unidadId: string;
  /** Texto decimal exacto con signo (`-1.2500`, `5.5000`). */
  cantidad: string;
  esAnulacion: boolean;
  anulado: boolean;
  anulable: boolean;
}>;

export type MovimientosParaLaPantalla = Readonly<{
  depositos: readonly DepositoParaElSelector[];
  depositoId: string | null;
  movimientos: readonly MovimientoParaLaPantalla[];
  siguiente: string | null;
}>;

const MOTIVOS_DE_RECHAZO: ReadonlySet<unknown> = new Set<string>([
  "MODULO_EN_DESARROLLO",
  "MODULO_NO_ACTIVO",
  "MODULO_EN_SOLO_LECTURA",
  "SIN_CAPACIDAD",
  "SIN_PERMISO",
]);

const forma = z.object({ depositoId: identificador.optional(), despues: texto.optional() });
type EntradaDeLectura = Readonly<{ depositoId: string | undefined; despues: string | undefined }>;

function entradaDeLectura(crudo: unknown): Resultado<EntradaDeLectura, ErrorDeEntrada> {
  const leida = leer(forma, crudo);
  return leida.ok
    ? ok({ depositoId: leida.valor.depositoId, despues: leida.valor.despues })
    : leida;
}

/** El cursor de las dos listas viaja como texto opaco: JSON en base64 de URL. Uno que no vuelve a la forma pedida no se acepta. */
const codificar = (cursor: object): string =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");

function decodificar<S extends z.ZodType>(
  opaco: string | undefined,
  forma: S,
): z.output<S> | undefined | "ROTO" {
  if (opaco === undefined || opaco === "") return undefined;
  try {
    const leido = forma.safeParse(JSON.parse(Buffer.from(opaco, "base64url").toString()));
    return leido.success ? leido.data : "ROTO";
  } catch {
    return "ROTO";
  }
}

/** La forma de cada cursor: solo lo que el servidor entrega y nada más (lista de permitidos; ante la duda se rechaza). La del cursor de movimientos es la de `CursorDeMovimientosDeDeposito`. */
const formaDelCursorDeExistencias = z
  .object({ nombreClave: z.string(), articuloId: z.string(), depositoId: z.string() })
  .strict();
const formaDelCursorDeMovimientos = z
  .object({ hechoEn: z.string(), movimientoId: z.string(), numero: z.number().int() })
  .strict() satisfies z.ZodType<CursorDeMovimientosDeDeposito>;

/** Los depósitos de la sucursal que se ofrecen en el selector (los activos) y el elegido: el pedido si es uno de ellos, si no el primero. Pedir uno que no está es el genérico. */
async function depositosYElegido(
  d: DependenciasDeExistenciasYLibroWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  pedido: string | undefined,
) {
  const lista = await d.consultas().listarDepositos(contexto, { sucursalId });
  if (!lista.ok) return lista;
  const depositos = lista.valor
    .filter((x) => x.activo)
    .map((x) => ({ id: x.id, nombre: x.nombre }));
  if (pedido !== undefined && !depositos.some((x) => x.id === pedido))
    return err("DEPOSITO_NO_ENCONTRADO");
  return ok({ depositos, depositoId: pedido ?? depositos[0]?.id ?? null });
}

type Elegido = Readonly<{
  depositos: readonly DepositoParaElSelector[];
  depositoId: string | null;
}>;
const SIN_EXISTENCIAS: PaginaDeExistencias = { existencias: [], siguiente: null };
const SIN_MOVIMIENTOS: PaginaDeMovimientosDeDeposito = { movimientos: [], siguiente: null };

/** Las existencias del depósito elegido de la sucursal elegida, de a una página. */
export function existenciasDelDeposito(
  d: DependenciasDeExistenciasYLibroWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<ExistenciasParaLaPantalla>> {
  return accionDeStock<
    EntradaDeLectura,
    Elegido & Readonly<{ pagina: PaginaDeExistencias }>,
    ExistenciasParaLaPantalla
  >(
    d.respuesta,
    crudo,
    entradaDeLectura,
    async (entrada) => {
      const cursor = decodificar(entrada.despues, formaDelCursorDeExistencias);
      if (cursor === "ROTO") return err("IDENTIFICADOR_INVALIDO");
      const elegido = await depositosYElegido(d, contexto, sucursalId, entrada.depositoId);
      if (!elegido.ok) return elegido;
      const { depositos, depositoId } = elegido.valor;
      if (depositoId === null) return ok({ depositos, depositoId, pagina: SIN_EXISTENCIAS });
      const pagina = await d.consultas().existencias(contexto, { depositoId, despuesDe: cursor });
      return pagina.ok ? ok({ depositos, depositoId, pagina: pagina.valor }) : pagina;
    },
    ({ depositos, depositoId, pagina }): ExistenciasParaLaPantalla => ({
      depositos,
      depositoId,
      existencias: pagina.existencias.map((x) => ({
        articuloId: x.articuloId,
        nombre: x.nombre,
        unidadId: x.unidadId,
        existencia: x.existencia,
        negativa: x.existencia.startsWith("-"),
      })),
      siguiente: pagina.siguiente === null ? null : codificar(pagina.siguiente),
    }),
  );
}

/** El libro del depósito elegido (solo lectura): una tarjeta por renglón, del más nuevo al más viejo, con el correo de quien lo registró. */
export function movimientosDelDeposito(
  d: DependenciasDeExistenciasYLibroWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<MovimientosParaLaPantalla>> {
  return accionDeStock<
    EntradaDeLectura,
    Elegido &
      Readonly<{ pagina: PaginaDeMovimientosDeDeposito; correos: ReadonlyMap<string, string> }>,
    MovimientosParaLaPantalla
  >(
    d.respuesta,
    crudo,
    entradaDeLectura,
    async (entrada) => {
      const cursor = decodificar(entrada.despues, formaDelCursorDeMovimientos);
      if (cursor === "ROTO") return err("IDENTIFICADOR_INVALIDO");
      const elegido = await depositosYElegido(d, contexto, sucursalId, entrada.depositoId);
      if (!elegido.ok) return elegido;
      const { depositos, depositoId } = elegido.valor;
      if (depositoId === null)
        return ok({
          depositos,
          depositoId,
          pagina: SIN_MOVIMIENTOS,
          correos: new Map<string, string>(),
        });
      const pagina = await d
        .consultas()
        .movimientosDelDeposito(contexto, { depositoId, despuesDe: cursor });
      if (!pagina.ok) return pagina;
      const ids = [...new Set(pagina.valor.movimientos.map((m) => m.registradoPor))];
      const personas =
        ids.length === 0
          ? ok(new Map<ReturnType<typeof personaId>, string>())
          : await d.consultasDeIdentidad().personasParaMostrar(contexto, { ids });
      // Sin permiso para ver personas, la lista sale con el correo en `null`; cualquier otro fallo (base, entrada) no se esconde.
      if (!personas.ok && !MOTIVOS_DE_RECHAZO.has(personas.error)) return err(personas.error);
      const correos = new Map<string, string>(personas.ok ? personas.valor : []);
      return ok({ depositos, depositoId, pagina: pagina.valor, correos });
    },
    ({ depositos, depositoId, pagina, correos }): MovimientosParaLaPantalla => ({
      depositos,
      depositoId,
      movimientos: pagina.movimientos.map((m) => ({
        movimientoId: m.movimientoId,
        numero: m.numero,
        clase: m.clase,
        motivo: m.motivo,
        hechoEn: m.hechoEn.toISOString(),
        quien: correos.get(m.registradoPor) ?? null,
        articuloId: m.articuloId,
        nombre: m.nombre,
        unidadId: m.unidadId,
        cantidad: m.cantidad,
        esAnulacion: m.esAnulacion,
        anulado: m.anulado,
        anulable: m.anulable,
      })),
      siguiente: pagina.siguiente === null ? null : codificar(pagina.siguiente),
    }),
  );
}

import type { Kysely } from "kysely";
import { empresaId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  comprobanteId,
  intentoId,
  type ComprobanteId,
  type IntentoId,
} from "../dominio/identificadores";
import {
  deLaLista,
  serializarAltaDeId,
  type ErrorDeAlta,
  type ResultadoDeAlta,
} from "./repositorios";
import type { FiscalDb } from "./tablas";

/**
 * Repositorio de los intentos contra ARCA (spec H7 facturación §B.5.5, §B.8.5): cada llamada por un
 * comprobante, de SOLO INSERCIÓN. Es la única evidencia de un CAE si el cierre falla después, por eso se
 * guarda ANTES de mover el comprobante. Lo que se guarda es lo que respondió ARCA, saneado: códigos y
 * mensajes, el resultado, la duración y la huella del pedido; nunca el pedido en crudo (lleva la
 * credencial) ni un `Token` o un `Sign` en la respuesta.
 */

export const OPERACIONES_DE_INTENTO = ["AUTORIZAR", "CONSULTAR", "ULTIMO_AUTORIZADO"] as const;
export type OperacionDeIntento = (typeof OPERACIONES_DE_INTENTO)[number];

export const DESENLACES_DE_INTENTO = [
  "AUTORIZADO",
  "RECHAZADO",
  "INCIERTO",
  "NO_ENVIADO",
  "ENCONTRADO",
  "NO_ENCONTRADO",
  "CONSULTA_FALLIDA",
  "RESPONDIDO",
] as const;
export type DesenlaceDeIntento = (typeof DESENLACES_DE_INTENTO)[number];

/** Qué dijo ARCA: un error, una observación o un evento, con su código y su texto crudos. */
export const CLASES_DE_MENSAJE = ["ERROR", "OBSERVACION", "EVENTO"] as const;
export type ClaseDeMensaje = (typeof CLASES_DE_MENSAJE)[number];

export type MensajeDeIntento = Readonly<{ clase: ClaseDeMensaje; codigo: number; texto: string }>;

export type IntentoDeArca = Readonly<{
  id: IntentoId;
  empresaId: EmpresaId;
  comprobanteId: ComprobanteId;
  operacion: OperacionDeIntento;
  /** El número que se autorizó o consultó; `null` si la operación no es sobre uno. */
  numero: bigint | null;
  desenlace: DesenlaceDeIntento;
  mensajes: readonly MensajeDeIntento[];
  /** La respuesta XML saneada (sin `Token` ni `Sign`), hasta 64 KB. */
  respuesta: string | null;
  /** SHA-256 del pedido: el pedido en sí no se guarda. */
  huellaDelPedido: string | null;
  iniciadoEn: Date;
  duracionEnMs: number;
}>;

export interface RepositorioDeIntentos {
  /**
   * Guarda el intento con el `id` de la aplicación (idempotente: repetir el MISMO intento devuelve el que
   * existe, `creado: false`, sin escribir). El mismo `id` con otro contenido, o de un intento que esta
   * empresa no ve, es `ID_EN_USO`: un intento no se corrige, se agrega otro.
   * Lanza `RangeError` si la respuesta trae una credencial (`<Token>`, `<Sign>` o un PEM): es un defecto
   * del adaptador, no un caso de negocio, y no puede llegar a la base.
   */
  registrar(
    intento: IntentoDeArca,
  ): Promise<Resultado<ResultadoDeAlta<IntentoDeArca>, ErrorDeAlta>>;
  /** Los intentos del comprobante, por orden de inicio (los empates, por `id`). */
  delComprobante(empresa: EmpresaId, comprobante: ComprobanteId): Promise<IntentoDeArca[]>;
}

/**
 * Lo que no puede estar en una respuesta que se guarda: la credencial de acceso (`Token` y `Sign` de WSAA) o
 * una clave o un certificado en PEM. Previene que una respuesta sin sanear deje la credencial en una tabla
 * que la aplicación puede leer (§B.5.5: «sin Token ni Sign»).
 */
const CREDENCIAL_EN_LA_RESPUESTA = /<\s*(?:[\w-]+:)?(?:token|sign)\b|-----BEGIN /i;

type FilaDeIntento = Readonly<{
  id: string;
  empresa_id: string;
  comprobante_id: string;
  operacion: string;
  numero: string | null;
  desenlace: string;
  mensajes: unknown;
  respuesta: string | null;
  huella_pedido: string | null;
  iniciado_en: Date;
  duracion_ms: number;
}>;

const COLUMNAS_DE_INTENTO = [
  "id",
  "empresa_id",
  "comprobante_id",
  "operacion",
  "numero",
  "desenlace",
  "mensajes",
  "respuesta",
  "huella_pedido",
  "iniciado_en",
  "duracion_ms",
] as const;

/** Los mensajes que la base guardó como `jsonb`: si no tienen la forma, algo se rompió. */
function aMensajes(valor: unknown): readonly MensajeDeIntento[] {
  if (!Array.isArray(valor)) throw new RangeError("los mensajes del intento no son una lista");
  return valor.map((m: unknown) => {
    if (typeof m !== "object" || m === null) throw new RangeError("mensaje de intento inválido");
    const { clase, codigo, texto } = m as Record<string, unknown>;
    if (typeof clase !== "string" || typeof codigo !== "number" || typeof texto !== "string") {
      throw new RangeError("mensaje de intento inválido");
    }
    return { clase: deLaLista(CLASES_DE_MENSAJE, clase, "clase de mensaje"), codigo, texto };
  });
}

function aIntento(fila: FilaDeIntento): IntentoDeArca {
  return {
    id: intentoId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    comprobanteId: comprobanteId(fila.comprobante_id),
    operacion: deLaLista(OPERACIONES_DE_INTENTO, fila.operacion, "operación de intento"),
    numero: fila.numero === null ? null : BigInt(fila.numero),
    desenlace: deLaLista(DESENLACES_DE_INTENTO, fila.desenlace, "desenlace de intento"),
    mensajes: aMensajes(fila.mensajes),
    respuesta: fila.respuesta,
    huellaDelPedido: fila.huella_pedido,
    iniciadoEn: fila.iniciado_en,
    duracionEnMs: fila.duracion_ms,
  };
}

/** Serie canónica de los mensajes (clave por clave, en orden fijo) para comparar dos intentos. */
const canonico = (mensajes: readonly MensajeDeIntento[]) =>
  JSON.stringify(mensajes.map((m) => [m.clase, m.codigo, m.texto]));

function mismoIntento(a: IntentoDeArca, b: IntentoDeArca): boolean {
  return (
    a.empresaId === b.empresaId &&
    a.comprobanteId === b.comprobanteId &&
    a.operacion === b.operacion &&
    a.numero === b.numero &&
    a.desenlace === b.desenlace &&
    canonico(a.mensajes) === canonico(b.mensajes) &&
    a.respuesta === b.respuesta &&
    a.huellaDelPedido === b.huellaDelPedido &&
    a.iniciadoEn.getTime() === b.iniciadoEn.getTime() &&
    a.duracionEnMs === b.duracionEnMs
  );
}

export function crearRepositorioDeIntentos(db: Kysely<FiscalDb>): RepositorioDeIntentos {
  const seleccionar = () => db.selectFrom("intento_arca").select(COLUMNAS_DE_INTENTO);

  async function obtener(empresa: EmpresaId, id: IntentoId): Promise<IntentoDeArca | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aIntento(fila);
  }

  return {
    async registrar(intento) {
      if (intento.respuesta !== null && CREDENCIAL_EN_LA_RESPUESTA.test(intento.respuesta)) {
        throw new RangeError("la respuesta de ARCA trae una credencial: se guarda sin sanear");
      }
      await serializarAltaDeId(db, "intento_arca", intento.id);
      const nuevo = await db
        .insertInto("intento_arca")
        .values({
          id: intento.id,
          empresa_id: intento.empresaId,
          comprobante_id: intento.comprobanteId,
          operacion: intento.operacion,
          numero: intento.numero === null ? null : intento.numero.toString(),
          desenlace: intento.desenlace,
          mensajes: JSON.stringify(intento.mensajes.map((m) => ({ ...m }))),
          respuesta: intento.respuesta,
          huella_pedido: intento.huellaDelPedido,
          iniciado_en: intento.iniciadoEn,
          duracion_ms: intento.duracionEnMs,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(intento.empresaId, intento.id);
      if (guardado === null) return err("ID_EN_USO");
      if (nuevo !== undefined) return ok({ creado: true, valor: guardado });
      return mismoIntento(guardado, intento)
        ? ok({ creado: false, valor: guardado })
        : err("ID_EN_USO");
    },

    async delComprobante(empresa, comprobante) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("comprobante_id", "=", comprobante)
        .orderBy("iniciado_en")
        .orderBy("id")
        .execute();
      return filas.map(aIntento);
    },
  };
}

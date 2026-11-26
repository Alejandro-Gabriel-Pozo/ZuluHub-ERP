import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  MOTIVOS_DE_DIFERENCIA,
  type FichaDeConteo,
  type RegistroDeFicha,
} from "../modulos/stock/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { leer } from "./entradas-de-facturacion";
import {
  comoAplicar,
  comoLectura,
  comoRegistro,
  formaDeAbrir,
  formaDeCancelar,
  formaDeRevisar,
  type EntradaDeLecturaDelConteo,
} from "./entradas-de-conteo";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * El conteo físico de stock en la web (STK-D, FP-STK-10 a FP-STK-12): abrir el conteo de un depósito, cargar lo contado por artículo, cancelarlo con motivo, revisarlo y aplicarlo. Reglas de esta capa:
 *  - **La sucursal la pone el servidor** y el depósito tiene que ser uno de los activos de ESA sucursal; el artículo, uno de los que se pueden mover (su producto y su unidad salen del servidor, nunca del navegador).
 *    Lo que no corresponde sale como el genérico, indistinguible de lo que no existe. El conteo, además, lo acota el alcance de sucursales que aplica el caso de uso.
 *  - **El conteo es A CIEGAS**: lo que el sistema creía a esa hora, lo movido desde entonces, la diferencia y la huella solo existen en lo que devuelve la consulta si quien mira puede aplicar (`conteos.aplicar`); esta capa NO los
 *    inventa ni los recalcula: pasa lo que viene y, si no vino, el campo no existe (una prueba afirma que el operador no los recibe).
 *  - **Idempotencia**: el id del conteo lo genera la página; cada guardado de un artículo lleva su propio id (recontar es otro id y vale el último); aplicar lleva el conteo y la huella de lo que se vio (una aplicación repetida
 *    devuelve lo hecho, y si entró un movimiento mientras se revisaba es `REVISION_DESACTUALIZADA` y la pantalla recarga). La hora del conteo viaja como «HH:MM» y la resuelve el servidor con la zona de la sucursal; vacía
 *    vale la de la carga. Cantidades como texto decimal exacto (ADR-006); cero es válido. Sin importes: no hay valorización de la diferencia.
 */

export type DependenciasDeConteoWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeStock"]>,
    "abrirConteo" | "registrarConteo" | "aplicarConteo" | "cancelarConteo"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeStock"]>,
    "articulosControlados" | "listarDepositos" | "listarConteos" | "fichaDeConteo"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

// ---- lo que sale hacia la pantalla ----------------------------------------------------------------------------------------------

export type ArticuloDeLaCarga = Readonly<{
  articuloId: string;
  nombre: string;
  unidadId: string;
  /** Lo último que se guardó de este artículo en el conteo abierto (texto decimal), o `null` si todavía no se contó. */
  contado: string | null;
}>;

export type LecturaDelConteo = Readonly<{
  depositos: readonly Readonly<{ id: string; nombre: string }>[];
  depositoId: string | null;
  /** El conteo abierto del depósito, o `null` si no hay. */
  conteoId: string | null;
  /** Solo con un conteo abierto: todos los artículos que se pueden contar. */
  articulos: readonly ArticuloDeLaCarga[];
}>;

export type FilaDeRevision = Readonly<{
  articuloId: string;
  nombre: string;
  unidadId: string;
  contada: string;
  /** ISO UTC de la hora a la que se contó. */
  contadoEn: string;
  /** Solo si quien mira puede aplicar el conteo (a ciegas para el resto): lo que el sistema creía a esa hora, lo movido desde entonces y la diferencia. */
  sistema?: string;
  movido?: string;
  diferencia?: string;
  /** Los motivos que se pueden elegir según el sentido de la diferencia (faltante o sobrante); ausente si no hay diferencia o no se ve. */
  motivos?: readonly Readonly<{ codigo: string; pideDetalle: boolean }>[];
}>;

export type FilaAplicada = Readonly<{
  articuloId: string;
  nombre: string;
  unidadId: string;
  contada: string;
  diferencia: string;
  motivo: string | null;
  detalle: string | null;
}>;

export type RevisionDelConteo = Readonly<{
  conteoId: string;
  estado: "ABIERTO" | "APLICADO" | "CANCELADO";
  /** La huella de lo mostrado: solo con permiso de aplicar y con el conteo abierto. */
  huella: string | null;
  filas: readonly FilaDeRevision[];
  /** Solo con permiso de aplicar y con el conteo aplicado. */
  aplicadas: readonly FilaAplicada[];
}>;

const MOTIVOS_DE = (sentido: "FALTANTE" | "SOBRANTE") =>
  MOTIVOS_DE_DIFERENCIA.filter((m) => m.sentido === sentido)
    .sort((a, b) => a.orden - b.orden)
    .map((m) => ({ codigo: m.codigo, pideDetalle: m.pideDetalle }));

/** Faltante si la diferencia (texto decimal con signo) es negativa, sobrante si es positiva, `null` si es cero. */
const sentidoDe = (diferencia: string): "FALTANTE" | "SOBRANTE" | null =>
  diferencia.startsWith("-") ? "FALTANTE" : /[1-9]/.test(diferencia) ? "SOBRANTE" : null;

// ---- lecturas ---------------------------------------------------------------------------------------------------------------------

async function depositosDe(
  d: DependenciasDeConteoWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
) {
  const lista = await d.consultas().listarDepositos(contexto, { sucursalId });
  if (!lista.ok) return lista;
  return ok(lista.valor.filter((x) => x.activo).map((x) => ({ id: x.id, nombre: x.nombre })));
}

/** El último registro de cada artículo (el vigente). */
const vigentes = (registros: readonly RegistroDeFicha[]): ReadonlyMap<string, RegistroDeFicha> =>
  new Map(registros.filter((r) => r.vigente).map((r) => [r.articuloId, r]));

/** El conteo abierto del depósito elegido (o del primero) de la sucursal, con los artículos que se pueden contar y lo ya cargado. */
export function lecturaDelConteo(
  d: DependenciasDeConteoWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<LecturaDelConteo>> {
  return accionDeStock<EntradaDeLecturaDelConteo, LecturaDelConteo, LecturaDelConteo>(
    d.respuesta,
    crudo,
    comoLectura,
    async (entrada) => {
      const depositos = await depositosDe(d, contexto, sucursalId);
      if (!depositos.ok) return depositos;
      if (
        entrada.depositoId !== undefined &&
        !depositos.valor.some((x) => x.id === entrada.depositoId)
      ) {
        return err("DEPOSITO_NO_ENCONTRADO" as const);
      }
      const depositoId = entrada.depositoId ?? depositos.valor[0]?.id ?? null;
      const sinConteo = { depositos: depositos.valor, depositoId, conteoId: null, articulos: [] };
      if (depositoId === null) return ok(sinConteo);
      const abiertos = await d
        .consultas()
        .listarConteos(contexto, { depositoId, estado: "ABIERTO" });
      if (!abiertos.ok) return abiertos;
      const abierto = abiertos.valor[0];
      if (abierto === undefined) return ok(sinConteo);
      const ficha = await d.consultas().fichaDeConteo(contexto, { conteoId: abierto.id });
      if (!ficha.ok) return ficha;
      if (ficha.valor === null) return ok(sinConteo);
      const articulos = await d.consultas().articulosControlados(contexto);
      if (!articulos.ok) return articulos;
      const cargados = vigentes(ficha.valor.registros);
      return ok({
        depositos: depositos.valor,
        depositoId,
        conteoId: abierto.id,
        articulos: articulos.valor.map((a) => ({
          articuloId: a.articuloId,
          nombre: a.nombre,
          unidadId: a.unidadId,
          contado: cargados.get(a.articuloId)?.cantidadContada ?? null,
        })),
      });
    },
    (l) => l,
  );
}

/** La revisión de un conteo (o su resultado si ya se aplicó): por artículo contado, lo contado y, solo con permiso de aplicar, lo que el sistema creía, lo movido y la diferencia con los motivos que corresponden. */
export function revisionDelConteo(
  d: DependenciasDeConteoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<RevisionDelConteo>> {
  return accionDeStock<
    Readonly<{ conteoId: string }>,
    Readonly<{
      ficha: FichaDeConteo;
      nombres: ReadonlyMap<string, { nombre: string; unidadId: string }>;
    }>,
    RevisionDelConteo
  >(
    d.respuesta,
    crudo,
    (c) => {
      const f = leer(formaDeRevisar, c);
      return f.ok ? ok({ conteoId: f.valor.conteoId }) : f;
    },
    async (entrada) => {
      const ficha = await d.consultas().fichaDeConteo(contexto, { conteoId: entrada.conteoId });
      if (!ficha.ok) return ficha;
      if (ficha.valor === null) return err("CONTEO_NO_ENCONTRADO" as const);
      const articulos = await d.consultas().articulosControlados(contexto);
      if (!articulos.ok) return articulos;
      return ok({
        ficha: ficha.valor,
        nombres: new Map(
          articulos.valor.map((a) => [a.articuloId, { nombre: a.nombre, unidadId: a.unidadId }]),
        ),
      });
    },
    ({ ficha, nombres }): RevisionDelConteo => {
      const nombreDe = (articuloId: string) =>
        nombres.get(articuloId) ?? { nombre: "", unidadId: "" };
      const filas = [...vigentes(ficha.registros).values()].map((r): FilaDeRevision => {
        const base = {
          articuloId: r.articuloId,
          ...nombreDe(r.articuloId),
          contada: r.cantidadContada,
          contadoEn: r.contadoEn.toISOString(),
        };
        if (r.diferenciaBruta === undefined) return base;
        const sentido = sentidoDe(r.diferenciaBruta);
        return {
          ...base,
          ...(r.existenciaALaHora === undefined ? {} : { sistema: r.existenciaALaHora }),
          ...(r.movidoDesdeLaHora === undefined ? {} : { movido: r.movidoDesdeLaHora }),
          diferencia: r.diferenciaBruta,
          ...(sentido === null ? {} : { motivos: MOTIVOS_DE(sentido) }),
        };
      });
      return {
        conteoId: ficha.conteo.id,
        estado: ficha.conteo.estado,
        huella: ficha.huella ?? null,
        filas,
        aplicadas: (ficha.explicaciones ?? []).map((e) => ({
          articuloId: e.articuloId,
          ...nombreDe(e.articuloId),
          contada: e.contada,
          diferencia: e.diferenciaFinal,
          motivo: e.motivo,
          detalle: e.detalle,
        })),
      };
    },
  );
}

// ---- acciones ---------------------------------------------------------------------------------------------------------------------

type Hecho = Readonly<{ yaExistia: boolean }>;

/** Abre el conteo de un depósito de la sucursal. Otro abierto en el mismo depósito sale con su texto propio («Ya hay un conteo abierto en este depósito»). */
export function abrirElConteo(
  d: DependenciasDeConteoWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Hecho & Readonly<{ conteoId: string }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    (c) => {
      const f = leer(formaDeAbrir, c);
      return f.ok ? ok(f.valor) : f;
    },
    async (e) => {
      const depositos = await depositosDe(d, contexto, sucursalId);
      if (!depositos.ok) return depositos;
      if (!depositos.valor.some((x) => x.id === e.depositoId))
        return err("DEPOSITO_NO_ENCONTRADO" as const);
      return d.casosDeUso().abrirConteo(contexto, { id: e.id, depositoId: e.depositoId });
    },
    (s) => ({ conteoId: s.conteoId, yaExistia: s.yaExistia }),
  );
}

/** Guarda lo contado de UN artículo con su hora (vacía = la de la carga). Recontar es otro id y vale el último; el mismo id con lo mismo es el mismo registro. */
export function cargarLoContado(
  d: DependenciasDeConteoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Hecho>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    comoRegistro,
    async (e) => {
      const articulos = await d.consultas().articulosControlados(contexto);
      if (!articulos.ok) return articulos;
      const articulo = articulos.valor.find((a) => a.articuloId === e.articuloId);
      if (articulo === undefined) return err("ARTICULO_NO_CONTROLADO" as const);
      return d.casosDeUso().registrarConteo(contexto, {
        id: e.id,
        conteoId: e.conteoId,
        productoId: articulo.productoId,
        cantidadContada: e.cantidad,
        unidadId: articulo.unidadId,
        horaDelConteo: e.hora,
      });
    },
    (s) => ({ yaExistia: s.yaExistia }),
  );
}

/** Cancela un conteo abierto con su motivo. */
export function cancelarElConteo(
  d: DependenciasDeConteoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    (c) => {
      const f = leer(formaDeCancelar, c);
      return f.ok ? ok(f.valor) : f;
    },
    (e) => d.casosDeUso().cancelarConteo(contexto, { conteoId: e.conteoId, motivo: e.motivo }),
    (s) => ({ yaEstaba: s.yaEstaba }),
  );
}

/** Aplica el conteo con la huella de lo que se vio y el motivo de cada diferencia. Repetirlo devuelve lo hecho; si entró un movimiento mientras se revisaba, no se aplica y la pantalla recarga. */
export function aplicarElConteo(
  d: DependenciasDeConteoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ movimientoId: string | null; yaAplicado: boolean }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    comoAplicar,
    async (e) => {
      const articulos = await d.consultas().articulosControlados(contexto);
      if (!articulos.ok) return articulos;
      const productoDe = new Map(articulos.valor.map((a) => [a.articuloId, a.productoId]));
      const respuestas = [];
      for (const r of e.respuestas) {
        const productoId = productoDe.get(r.articuloId);
        if (productoId === undefined) return err("ARTICULO_NO_CONTROLADO" as const);
        respuestas.push({ productoId, motivo: r.motivo ?? null, detalle: r.detalle ?? null });
      }
      return d
        .casosDeUso()
        .aplicarConteo(contexto, { conteoId: e.conteoId, huella: e.huella, respuestas });
    },
    (s) => ({ movimientoId: s.movimientoId, yaAplicado: s.yaAplicado }),
  );
}

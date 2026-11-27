import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type {
  CasosDeUsoDeSalon,
  ConsultasDeSalon,
  FichaDeMesa,
  FiltroDelMapa,
  MesaDelMapa,
} from "../modulos/salon/publico";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import {
  leerElPedidoDeAgregarAlPedido,
  leerElPedidoDeCambiarDeMesa,
  leerElPedidoDeTomarPedido,
  leerElPedidoDeUnaCuenta,
  leerElPedidoDelMapa,
} from "./entradas-de-cuenta-de-mesa";
import { leerElPedidoDeUnaMesa } from "./entradas-de-mesas";
import { accionDelSalon, traducirErrorDeSalon } from "./errores-de-salon";

/**
 * La cuenta de mesa del salón (S-0r; E7 §3.4 y §3.6; la base de S-3): el mapa de mesas, la ficha de una mesa, «Tomar pedido», «Liberar mesa» y «Cambiar de mesa». Vive acá, y no en
 * `apps/web`, para probarse con la base real sin levantar Next (igual que `mesas-web.ts`). La cuenta de la mesa es la misma cuenta y el mismo motor del mostrador (E7 §1.3).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/cuenta-de-mesa-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta** (`mesas.ver`, `cuentas.abrir`, `cuentas.anular`, `salon.cambiar_mesa`): acá no se decide ninguno. Con `salon` en desarrollo, sin la
 *    perilla del plan o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La sucursal la pone el servidor** (`sucursalId` llega ya resuelta por `apps/web/servidor/salon.ts`, nunca del pedido): vacía (sin sucursal elegida) cierra con el genérico, nunca se
 *    asume «todas». Una mesa o una cuenta que no es de esa sucursal es indistinguible de una que no existe: el genérico.
 *  - **Repetir no duplica.** Tomar pedido lleva el id de la cuenta que fijó la pantalla: dos toques, o dos pestañas sobre la misma mesa, son UNA cuenta (`yaExistia`). Liberar y cambiar de
 *    mesa repetidos devuelven `yaEstabaLibre` y `yaExistia`, sin escribir ni auditar de más. Dos mozos a la vez: gana uno y el otro recibe la cuenta del que ganó (lo decide el caso de uso con la única de la base).
 *  - **Nada de más sale.** Lista blanca campo por campo; el dinero, como texto decimal con su moneda. El mozo viaja como `mozoId`: su nombre lo resuelve la pantalla cuando identidad lo ofrezca.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeSalon`: el genérico para toda regla del negocio que no tiene texto propio).
 *
 * Límite que se asienta: que la mesa o la cuenta sea de la sucursal de trabajo se comprueba contra el mapa de ESA sucursal (la mesa nunca cambia de sucursal; «Cambiar de mesa» es solo dentro de ella). «Liberar mesa» no
 * lo exige contra el mapa porque, repetido, la cuenta ya anulada no figura y debe devolver `yaEstabaLibre`: ahí valen la empresa y el alcance de sucursales que el caso de uso valida.
 */

export type DependenciasDeCuentaDeMesaWeb = Readonly<{
  casosDeUso: () => Pick<
    CasosDeUsoDeSalon,
    "tomarPedido" | "agregarAlPedido" | "liberarMesa" | "cambiarDeMesa"
  >;
  consultas: () => Pick<ConsultasDeSalon, "mapaDeMesas" | "fichaDeMesa">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Lo único que hace falta para saber qué mesas y cuentas son de la sucursal de trabajo. */
type ConElMapa = Readonly<{ consultas: () => Pick<ConsultasDeSalon, "mapaDeMesas"> }>;

export type MesaDelMapaParaLaPantalla = MesaDelMapa;
export type MapaParaLaPantalla = Readonly<{ mesas: readonly MesaDelMapaParaLaPantalla[] }>;
export type FichaParaLaPantalla = FichaDeMesa;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, d: DependenciasDeCuentaDeMesaWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeSalon(error), d.respuesta),
});

const importe = (i: { moneda: string; monto: string }) => ({ moneda: i.moneda, monto: i.monto });

/** Lista blanca de lo que sale de una mesa del mapa: nada más que lo que la pantalla usa. */
const mesaParaLaPantalla = (m: MesaDelMapa): MesaDelMapaParaLaPantalla => ({
  mesaId: m.mesaId,
  numero: m.numero,
  forma: m.forma,
  tamano: m.tamano,
  columna: m.columna,
  fila: m.fila,
  estado: m.estado,
  ...(m.cuentaId === undefined ? {} : { cuentaId: m.cuentaId }),
  ...(m.total === undefined ? {} : { total: importe(m.total) }),
  ...(m.mozoId === undefined ? {} : { mozoId: m.mozoId }),
  ...(m.minutosAbierta === undefined ? {} : { minutosAbierta: m.minutosAbierta }),
  ...(m.unidaAMesa === undefined ? {} : { unidaAMesa: m.unidaAMesa }),
  ...(m.cuentasHijas === undefined
    ? {}
    : {
        cuentasHijas: m.cuentasHijas.map((h) => ({
          cuentaId: h.cuentaId,
          numero: h.numero,
          total: importe(h.total),
        })),
      }),
});

const fichaParaLaPantalla = (f: FichaDeMesa): FichaParaLaPantalla => ({
  mesaId: f.mesaId,
  numero: f.numero,
  estado: f.estado,
  unidaAMesa: f.unidaAMesa,
  cuentas: f.cuentas.map((c) => ({
    cuentaId: c.cuentaId,
    parte: c.parte,
    cobrada: c.cobrada,
    total: importe(c.total),
    lineas: c.lineas.map((l) => ({
      lineaId: l.lineaId,
      posicion: l.posicion,
      descripcion: l.descripcion,
      varianteNombre: l.varianteNombre,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      pasoDeCantidad: l.pasoDeCantidad,
      importe: l.importe,
      nota: l.nota,
      compartida: l.compartida,
      comanda: l.comanda,
      numeroDeEnvio: l.numeroDeEnvio,
      envioId: l.envioId,
      deLaMesa: l.deLaMesa,
    })),
  })),
});

/**
 * Todas las mesas activas de la sucursal con su estado, tal como las ve el servidor. Es una LECTURA que no escribe ni audita. La usan el mapa y, para saber qué mesas y qué cuentas son
 * de la sucursal de trabajo, las demás operaciones (también las de `comandas-web.ts`).
 */
export async function leerElMapaDeLaSucursal(
  d: ConElMapa,
  contexto: ContextoOperativo,
  sucursalId: string,
  filtro: FiltroDelMapa,
) {
  return d.consultas().mapaDeMesas(contexto, { sucursalId, filtro });
}

/** El mapa de mesas de la sucursal de trabajo, con el filtro que se pidió (sin filtro, «Todas»). Sin sucursal, el genérico. */
export async function verElMapaDeMesas(
  d: DependenciasDeCuentaDeMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo?: unknown,
): Promise<Respuesta<MapaParaLaPantalla>> {
  if (sucursalId === "") return { ok: false, error: GENERICO };
  const pedido = leerElPedidoDelMapa(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const mapa = await leerElMapaDeLaSucursal(d, contexto, sucursalId, pedido.valor.filtro);
    if (!mapa.ok) return conError(mapa.error, d);
    return { ok: true, dato: { mesas: mapa.valor.map(mesaParaLaPantalla) } };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** ¿La mesa figura en el mapa de la sucursal? Una mesa de otra sucursal, de otra empresa, inactiva o inexistente da lo mismo: no. */
async function laMesaEsDeLaSucursal(
  d: DependenciasDeCuentaDeMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  mesaId: string,
) {
  const mapa = await leerElMapaDeLaSucursal(d, contexto, sucursalId, "TODAS");
  if (!mapa.ok) return mapa;
  return { ok: true as const, valor: mapa.valor.some((m) => m.mesaId === mesaId) };
}

/**
 * ¿La cuenta es de una mesa de la sucursal (la cuenta de la mesa o una de las hijas de una división)? Una cuenta de otra sucursal, de otra empresa o que no existe da lo mismo: no.
 * La cuenta de reserva de una unión no figura a propósito: nadie opera sobre ella.
 */
export async function laCuentaEsDeLaSucursal(
  d: ConElMapa,
  contexto: ContextoOperativo,
  sucursalId: string,
  cuentaId: string,
) {
  const mapa = await leerElMapaDeLaSucursal(d, contexto, sucursalId, "TODAS");
  if (!mapa.ok) return mapa;
  return {
    ok: true as const,
    valor: mapa.valor.some(
      (m) => m.cuentaId === cuentaId || m.cuentasHijas?.some((h) => h.cuentaId === cuentaId),
    ),
  };
}

/** La ficha de una mesa de la sucursal de trabajo (sus cuentas con las líneas y su estado de comanda). Un `mesaId` mal formado o de otra sucursal es el genérico, el mismo para ambos. */
export function verLaFichaDeLaMesa(
  d: DependenciasDeCuentaDeMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<FichaParaLaPantalla>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeUnaMesa,
    async (pedido) => {
      const es = await laMesaEsDeLaSucursal(d, contexto, sucursalId, pedido.mesaId);
      if (!es.ok) return es;
      return es.valor ? d.consultas().fichaDeMesa(contexto, { mesaId: pedido.mesaId }) : null;
    },
    fichaParaLaPantalla,
  );
}

/** «Tomar pedido»: abre la cuenta de la mesa (o devuelve la que ya tiene). Repetir, o dos pestañas, es una sola cuenta. */
export function tomarElPedido(
  d: DependenciasDeCuentaDeMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ cuentaId: string; yaExistia: boolean }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeTomarPedido,
    async (pedido) => {
      const es = await laMesaEsDeLaSucursal(d, contexto, sucursalId, pedido.mesaId);
      if (!es.ok) return es;
      return es.valor
        ? d.casosDeUso().tomarPedido(contexto, { cuentaId: pedido.cuentaId, mesaId: pedido.mesaId })
        : null;
    },
    (salida) => ({ cuentaId: salida.cuentaId, yaExistia: salida.yaExistia }),
  );
}

/**
 * «Agregar» un producto al pedido: la línea entra en la cuenta con el precio del catálogo (nunca el del navegador) y queda «Sale ahora» o «Sale después». La cuenta tiene que ser de una mesa de la sucursal de trabajo.
 * Repetir con el mismo `lineaId` devuelve la misma línea (`yaExistia`); sin jornada de caja abierta no se agrega (el genérico).
 */
export function agregarAlPedidoDeLaMesa(
  d: DependenciasDeCuentaDeMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<
  Respuesta<
    Readonly<{
      posicion: number;
      precioUnitario: { moneda: string; monto: string };
      totalProvisorio: { moneda: string; monto: string };
      yaExistia: boolean;
    }>
  >
> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeAgregarAlPedido,
    async (pedido) => {
      const es = await laCuentaEsDeLaSucursal(d, contexto, sucursalId, pedido.cuentaId);
      if (!es.ok) return es;
      return es.valor ? d.casosDeUso().agregarAlPedido(contexto, pedido) : null;
    },
    (salida) => ({
      posicion: salida.posicion,
      precioUnitario: importe(salida.precioUnitario),
      totalProvisorio: importe(salida.totalProvisorio),
      yaExistia: salida.yaExistia,
    }),
  );
}

/** «Liberar mesa»: anula la cuenta sin líneas. Repetir devuelve `yaEstabaLibre`. */
export function liberarLaMesa(
  d: DependenciasDeCuentaDeMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaLibre: boolean }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeUnaCuenta,
    (pedido) => d.casosDeUso().liberarMesa(contexto, { cuentaId: pedido.cuentaId }),
    (salida) => ({ yaEstabaLibre: salida.yaEstabaLibre }),
  );
}

/** «Cambiar de mesa»: la cuenta pasa entera a una mesa libre de la misma sucursal. Repetir el mismo destino devuelve `yaExistia`. */
export function cambiarDeMesaLaCuenta(
  d: DependenciasDeCuentaDeMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDelSalon(
    d.respuesta,
    sucursalId,
    crudo,
    leerElPedidoDeCambiarDeMesa,
    async (pedido) => {
      const cuenta = await laCuentaEsDeLaSucursal(d, contexto, sucursalId, pedido.cuentaId);
      if (!cuenta.ok) return cuenta;
      const destino = await laMesaEsDeLaSucursal(d, contexto, sucursalId, pedido.mesaDestinoId);
      if (!destino.ok) return destino;
      return cuenta.valor && destino.valor ? d.casosDeUso().cambiarDeMesa(contexto, pedido) : null;
    },
    (salida) => ({ yaExistia: salida.yaExistia }),
  );
}

import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  anularElPago,
  cajasAbiertasParaPagar,
  declararElPago,
  type CajasParaPagarEnLaPantalla,
  type DependenciasDePagoDeFacturaWeb,
} from "../../../src/composicion/pago-de-factura-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { hoyEnArgentina } from "../../../src/primitivas/tiempo/fecha-civil-hasta-hoy";
import { pedidoDeMedios } from "../ui/plantillas/compras/pago/modelo-de-pago";
import { rutaDeLaCompra } from "../ui/plantillas/compras/rutas-de-compras";
import type {
  ResultadoDeAnularPago,
  ResultadoDeDeclararPago,
} from "../ui/plantillas/compras/pago/resultado-de-pago";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";
import { sucursalDelPedido } from "./sucursal-elegida";

/**
 * «Declarar pago» y anular un pago de una factura del proveedor (Compras PR 8). Finas a propósito (ADR-015, punto 2): la empresa y quién actúa salen de la SESIÓN, nunca del formulario ni de la dirección, y todo
 * lo demás (el permiso, el alcance de sucursal, la caja abierta, el pago único, la repetición) lo decide el servidor dentro de su transacción en `src/composicion/pago-de-factura-web.ts`. El importe no viaja: lo copia
 * el servidor del total de la factura. Ninguna redirige (un `redirect` dentro de una acción pierde el host): devuelven el resultado y la pantalla navega.
 */

const dependencias: DependenciasDePagoDeFacturaWeb = {
  casosDeUso: web.casosDeUsoDeCompras,
  consultasDeCaja: web.consultasDeCaja,
  respuesta: dependenciasDeSesion.respuesta,
};

/** La clave de UN intento de declarar el pago: la fija la página al abrirse. Previene: que un doble toque o un reintento por red cortada paguen (y saquen la plata de la caja) dos veces. */
export const nuevaClaveDePago = (): string => crypto.randomUUID();

const textoDe = (datos: FormData, nombre: string): string => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : "";
};

/** Todos los valores de un campo repetido (una fila por medio), en el orden del formulario; lo que no es texto cuenta como vacío. */
const textosDe = (datos: FormData, nombre: string): string[] =>
  datos.getAll(nombre).map((valor) => (typeof valor === "string" ? valor : ""));

/** Un campo que el formulario solo manda con efectivo: ausente es `undefined` (no «vacío»), para que el servidor distinga «sin caja» de «caja mal escrita». */
const textoOpcionalDe = (datos: FormData, nombre: string): string | undefined => {
  const valor = datos.get(nombre);
  return typeof valor === "string" ? valor : undefined;
};

/** La fecha, el medio o los medios con su importe, la caja y el motivo salen del formulario; la factura, la compra y la clave las liga la página con `.bind` (no viajan en un campo). */
export async function declararElPagoDeLaFactura(
  recepcionId: string,
  comprobanteId: string,
  clave: string,
  datos: FormData,
): Promise<ResultadoDeDeclararPago> {
  const cajaId = textoOpcionalDe(datos, "cajaId");
  const motivo = textoOpcionalDe(datos, "motivo");
  const r = await conLaEmpresa((contexto) =>
    declararElPago(dependencias, contexto, {
      clave,
      comprobanteId,
      fechaDePago: textoDe(datos, "fecha"),
      ...pedidoDeMedios(textosDe(datos, "medio"), textosDe(datos, "importe")),
      ...(cajaId === undefined ? {} : { cajaId }),
      ...(motivo === undefined ? {} : { motivo }),
    }),
  );
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLaCompra(recepcionId) }
    : { estado: "ERROR", error: r.error };
}

/** Anular el pago con el motivo del formulario; el pago y la compra los liga la página con `.bind`. */
export async function anularElPagoDeLaFactura(
  recepcionId: string,
  pagoId: string,
  datos: FormData,
): Promise<ResultadoDeAnularPago> {
  const r = await conLaEmpresa((contexto) =>
    anularElPago(dependencias, contexto, { pagoId, motivo: textoDe(datos, "motivo") }),
  );
  return r.ok
    ? { estado: "HECHO", ruta: rutaDeLaCompra(recepcionId) }
    : { estado: "ERROR", error: r.error };
}

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("COMPRAS_ACCION_NO_PERMITIDA") } as const;

/** Las cajas abiertas de la sucursal con la que trabaja la persona (nunca la que diga el navegador; sin ninguna, el genérico: nunca «todas»). */
export async function cargarLasCajasParaPagar(
  contexto: ContextoOperativo,
): Promise<Respuesta<CajasParaPagarEnLaPantalla>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  if (sucursal.dato.efectiva === "") return SIN_SUCURSAL;
  return cajasAbiertasParaPagar(dependencias, contexto, sucursal.dato.efectiva);
}

/** El día de hoy en Argentina (`AAAA-MM-DD`), con el reloj del servidor: es la fecha que trae el formulario y su tope. */
export function hoyParaElPago(ahora: Date): string | null {
  const hoy = hoyEnArgentina(ahora);
  return hoy.ok ? hoy.valor : null;
}

import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAnularNota,
  entradaDeNotasDeLaFactura,
  entradaDeRegistrarNota,
} from "./entradas-de-notas";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * Las pantallas de notas del proveedor (NOTAS-2c-1): «Notas de la factura», «Cargar una nota del proveedor» y «Anular» una nota, de crédito o de débito. Cada una es una LECTURA o un caso de uso del módulo, que ya trae
 * su permiso, su alcance de sucursal, su idempotencia y su transacción (`registrarNotaDeCredito`, `registrarNotaDeDebito`, `anularNotaDeCredito`, `anularNotaDeDebito`). Acá solo se arma el pedido:
 *  - **La empresa y la persona salen del contexto; el proveedor sale de la FACTURA** que la nota corrige (lo lee el servidor: el navegador no lo manda). Una factura que no existe, es de otra empresa o está fuera del
 *    alcance es indistinguible.
 *  - **Lo que se debe lo calcula el servidor**: la pantalla muestra el neto a pagar y el saldo a favor tal como salen de `notasDeLaFactura`, sin sumar ni restar.
 *  - La clase (crédito o débito) la fija quien llama, no el pedido; todo lo demás sale campo por campo (lista de permitidos). Los errores de negocio salen como el genérico (salvo el de la nota ya descontada por un pago).
 * Previene: una nota repetida por doble toque o reintento, una nota de otro proveedor o de otra empresa, importes de la pantalla que difieren de los del servidor. Chequeo: `test/integracion/compras-notas-web.test.ts`.
 */

export type ClaseDeNotaWeb = "CREDITO" | "DEBITO";

export type DependenciasDeNotasWeb = Readonly<{
  consultas: () => Pick<ReturnType<Web["consultasDeCompras"]>, "notasDeLaFactura">;
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCompras"]>,
    | "registrarNotaDeCredito"
    | "registrarNotaDeDebito"
    | "anularNotaDeCredito"
    | "anularNotaDeDebito"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export type NotasDeLaFacturaParaLaPantalla = Readonly<{
  facturaId: string;
  /** Cómo se nombra la factura: tipo, punto de venta y número. */
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  /** Importes como TEXTO decimal, tal cual los calcula el servidor. */
  totalDeLaFactura: string;
  acreditado: string;
  debitado: string;
  netoAPagar: string;
  /** Solo si un pago vigente supera al neto de hoy; informativo. */
  saldoAFavorPendiente: string | null;
  notas: readonly Readonly<{
    comprobanteId: string;
    clase: "NOTA_DE_CREDITO" | "NOTA_DE_DEBITO";
    tipo: string;
    puntoDeVenta: number;
    numero: number;
    fechaNegocio: string;
    total: string;
    estado: string;
  }>[];
}>;

/** Las notas de una factura de la empresa con lo que se acredita, lo que se debita, el neto a pagar y el saldo a favor; una factura que no existe o es de otra empresa sale igual (el genérico). */
export function notasDeLaFactura(
  d: DependenciasDeNotasWeb,
  contexto: ContextoOperativo,
  facturaId: string,
): Promise<Respuesta<NotasDeLaFacturaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { facturaId },
    entradaDeNotasDeLaFactura,
    async (entrada) => {
      const lectura = await d.consultas().notasDeLaFactura(contexto, entrada);
      if (!lectura.ok) return lectura;
      if (lectura.valor === null) return err("COMPROBANTE_NO_ENCONTRADO");
      return ok(lectura.valor);
    },
    (n) => ({
      facturaId: n.facturaId,
      tipo: n.tipo,
      puntoDeVenta: n.puntoDeVenta,
      numero: n.numero,
      totalDeLaFactura: n.totalDeLaFactura,
      acreditado: n.acreditado,
      debitado: n.debitado,
      netoAPagar: n.netoAPagar,
      saldoAFavorPendiente: n.saldoAFavorPendiente,
      notas: n.notas.map((x) => ({
        comprobanteId: x.comprobanteId,
        clase: x.clase,
        tipo: x.tipo,
        puntoDeVenta: x.puntoDeVenta,
        numero: x.numero,
        fechaNegocio: x.fechaNegocio,
        total: x.total,
        estado: x.estado,
      })),
    }),
  );
}

export type NotaRegistradaParaLaPantalla = Readonly<{
  comprobanteId: string;
  /** `true`: era la misma nota de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/**
 * «Cargar una nota del proveedor»: registra la nota de la clase pedida sobre la factura que corrige. El proveedor es el de la factura (lo lee el servidor). El permiso (`notas_de_credito_de_proveedor.registrar` o
 * `notas_de_debito_de_proveedor.registrar`), el alcance, que el tipo sea de la clase, las cuentas, el tope de lo acreditable (bajo el bloqueo de la factura) y la idempotencia los decide el caso de uso adentro.
 */
export function registrarLaNota(
  d: DependenciasDeNotasWeb,
  contexto: ContextoOperativo,
  clase: ClaseDeNotaWeb,
  crudo: unknown,
): Promise<Respuesta<NotaRegistradaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeRegistrarNota,
    async (entrada) => {
      const factura = await d
        .consultas()
        .notasDeLaFactura(contexto, { facturaId: entrada.facturaId });
      if (!factura.ok) return factura;
      if (factura.valor === null) return err("COMPROBANTE_NO_ENCONTRADO");
      const casos = d.casosDeUso();
      const pedido = {
        clave: entrada.clave,
        proveedorId: factura.valor.proveedorId,
        facturaId: entrada.facturaId,
        nota: entrada.nota,
      };
      return clase === "CREDITO"
        ? casos.registrarNotaDeCredito(contexto, pedido)
        : casos.registrarNotaDeDebito(contexto, pedido);
    },
    (salida) => ({ comprobanteId: salida.comprobanteId, yaExistia: salida.yaExistia }),
  );
}

/** «Anular» una nota: con motivo, una sola vez; lo que acreditaba vuelve a la factura. Una nota que ya descontó un pago no se anula hasta anular el pago (código propio, texto del dueño). */
export function anularLaNota(
  d: DependenciasDeNotasWeb,
  contexto: ContextoOperativo,
  clase: ClaseDeNotaWeb,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeAnularNota,
    (entrada) => {
      const pedido = { comprobanteId: entrada.notaId, motivo: entrada.motivo };
      const casos = d.casosDeUso();
      return clase === "CREDITO"
        ? casos.anularNotaDeCredito(contexto, pedido)
        : casos.anularNotaDeDebito(contexto, pedido);
    },
    (salida) => ({ yaEstaba: salida.yaEstaba }),
  );
}

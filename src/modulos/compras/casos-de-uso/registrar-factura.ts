import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { esClaseComprable } from "../../catalogo/publico";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { huellaDeLaFacturaSeparada, leerFacturaSeparada } from "../dominio/conciliacion-separada";
import type { NivelDeCompra } from "../dominio/niveles";
import { decidirPorHuella } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { asentarElCargoDeLaFactura } from "./cargo-de-la-factura";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { exigirNivelSeparado } from "./nivel-separado";
import {
  exigirFacturaNueva,
  guardarFactura,
  leerCondicionDeIva,
  prepararFactura,
} from "./registrar-compra-apoyo";
import type { AvisoDeCompra } from "./registrar-compra-tipos";

type R<S> = Resultado<S, ErrorDeCompras>;
type ValorDeFacturaSeparada = Extract<
  ReturnType<typeof leerFacturaSeparada>,
  { ok: true }
>["valor"];

const directorio = crearDirectorioDePartes();

export type EntradaDeRegistrarFactura = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia de la factura. */
  clave: string;
  proveedorId: string;
  /** La factura (`dominio/conciliacion-separada.ts`): como la de N2 pero cada línea dice su `productoId` en lugar de un renglón. */
  factura: unknown;
}>;

export type SalidaDeRegistrarFactura = Readonly<{
  comprobanteId: string;
  /** `true`: la misma factura ya estaba registrada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
  avisos: readonly AvisoDeCompra[];
}>;

/**
 * Cargar la factura del proveedor SOLA (N3 y N4, E9 §3.8: «Facturada, falta recibir» o la que llega después de la mercadería). Guard `comprobantes_de_proveedor.registrar`;
 * la empresa tiene que estar en N3 o N4 con la perilla del plan. Guarda el comprobante con sus líneas (cada una con su producto), importes y percepciones, SIN conciliar y
 * SIN tocar stock: la conciliación con lo recibido es otro acto (`conciliarFactura`). Las cuentas, el CUIT del proveedor, la letra y el total que no coincide son los de N2.
 * Repetición: misma clave y misma huella devuelve lo hecho (`yaExistia`); misma clave con otro contenido, `CLAVE_REUTILIZADA`; la misma factura (tipo, punto de venta y número del
 * mismo proveedor) con otra clave, `COMPROBANTE_YA_REGISTRADO` con la ganadora.
 */
export function armarRegistrarFactura(dependencias: DependenciasDeCompras) {
  return async function registrarFactura(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarFactura,
  ): Promise<R<SalidaDeRegistrarFactura>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    if (!esUuid(entrada.clave) || !esUuid(entrada.proveedorId))
      return err("IDENTIFICADOR_INVALIDO");
    const leida = leerFacturaSeparada(entrada.factura);
    if (!leida.ok) return leida;
    const huella = huellaDeLaFacturaSeparada(entrada.proveedorId, leida.valor);

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeRegistrarFactura>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "comprobantes_de_proveedor.registrar",
          ]);
          if (!permiso.ok) return permiso;
          const nivel = await exigirNivelSeparado(tx, contexto);
          if (!nivel.ok) return nivel;

          const previa = await tx.comprobantesDeProveedor.porClave(empresaId, entrada.clave);
          if (previa !== null) {
            if (decidirPorHuella(previa.huella, huella) !== "REPETIDA")
              return err("CLAVE_REUTILIZADA");
            return ok({ comprobanteId: previa.id, yaExistia: true, avisos: [] });
          }
          return registrarFacturaEnTx(tx, contexto, dependencias, {
            clave: entrada.clave,
            proveedorId: entrada.proveedorId,
            leida: leida.valor,
            huella,
            nivel: nivel.valor,
            reemplazaAId: null,
          });
        },
      ),
    );
  };
}

/**
 * Lo que cargar una factura sola hace DENTRO de una transacción que ya autorizó, ya miró la repetición y ya tiene el nivel: el proveedor, el duplicado, los productos, las cuentas, el comprobante con sus líneas, la auditoría y el cargo
 * en el libro. Lo usan `registrarFactura` y el reemplazo de una factura (`reemplazaAId`: la que la nueva reemplaza, ya anulada en esa misma transacción).
 */
export async function registrarFacturaEnTx(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  datos: Readonly<{
    clave: string;
    proveedorId: string;
    leida: ValorDeFacturaSeparada;
    huella: string;
    nivel: NivelDeCompra;
    reemplazaAId: string | null;
  }>,
): Promise<R<SalidaDeRegistrarFactura>> {
  const { empresaId } = contexto;
  if (contexto.personaId === null) return err("SIN_PERMISO");
  const persona = contexto.personaId;
  const { factura, productos } = datos.leida;
  const proveedor = await directorio.parteParaOperacion(
    tx,
    empresaId,
    datos.proveedorId,
    "PROVEEDOR",
  );
  if (!proveedor.ok) return err("PROVEEDOR_NO_ENCONTRADO");
  const nueva = await exigirFacturaNueva(tx, empresaId, proveedor.valor.id, factura);
  if (!nueva.ok) return nueva;

  const deLaFactura = [];
  for (const productoId of productos) {
    const producto = await tx.productosParaCompras.bloquearCompartido(empresaId, productoId);
    if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
    if (!producto.activo || !esClaseComprable(producto.claseDeUso)) {
      return err("PRODUCTO_NO_COMPRABLE");
    }
    deLaFactura.push({
      descripcion: producto.nombre,
      unidad: producto.unidadBaseId,
      productoId: producto.id,
    });
  }
  const condicion = await leerCondicionDeIva(tx, contexto, dependencias, factura);
  if (!condicion.ok) return condicion;
  const preparada = await prepararFactura(
    tx,
    contexto,
    dependencias,
    proveedor.valor,
    factura,
    null,
    condicion.valor,
  );
  if (!preparada.ok) return preparada;

  const comprobanteId = await guardarFactura(tx, {
    empresaId,
    persona,
    recepcionId: null,
    proveedorId: proveedor.valor.id,
    nivel: datos.nivel,
    clave: datos.clave,
    huella: datos.huella,
    factura,
    lineas: [],
    deLaFactura,
    preparada: preparada.valor,
    reemplazaAId: datos.reemplazaAId,
  });
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "FACTURA_REGISTRADA",
    entidad: "comprobante_de_proveedor",
    entidadId: comprobanteId,
    despues: {
      proveedorId: proveedor.valor.id,
      nivel: datos.nivel,
      // Fecha de la factura: junto con la fecha de la auditoría (la de carga) permite ver qué facturas de meses anteriores se cargaron después.
      fechaDelComprobante: factura.fecha,
      lineas: factura.lineas.length,
      totalSegunFactura: preparada.valor.calculado.totalSegunFactura,
    },
  });
  // Al final: el libro toma el saldo del proveedor después del comprobante (ver `asentarElCargoDeLaFactura`).
  const cargo = await asentarElCargoDeLaFactura(tx, contexto, dependencias, {
    comprobanteId,
    proveedorId: proveedor.valor.id,
    total: preparada.valor.calculado.totalSegunFactura,
    venceEl: factura.vencimientoDePago,
    sucursalId: null,
  });
  if (!cargo.ok) return cargo;
  return ok({ comprobanteId, yaExistia: false, avisos: preparada.valor.avisos });
}

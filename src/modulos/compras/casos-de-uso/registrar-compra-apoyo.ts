import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { esClaseComprable } from "../../catalogo/publico";
import { crearRegistroDePartes } from "../../clientes/publico";
import { calcularLinea } from "../dominio/calcular-linea";
import {
  calcularComprobante,
  discriminaIva,
  esAlicuotaDeCompra,
  type AlicuotaDeCompra,
  type CondicionDeIvaDeLaEmpresa,
  esLetraNoEsperada,
  totalCoincide,
  type ComprobanteCalculado,
} from "../dominio/comprobante";
import { leerImporte } from "../dominio/decimal";
import {
  razonSocialDeLaParte,
  repartirConciliacionDeAtajo,
  tributosDeLaPantalla,
  type FacturaPedida,
} from "../dominio/factura";
import { alicuotaQueEntraAlCosto } from "../dominio/iva-en-el-costo";
import { claseDeComprobante, type NivelDeCompra } from "../dominio/niveles";
import { claveDeLaConciliacionDeAtajo, type RenglonDeCompra } from "../dominio/registrar-compra";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import type {
  AvisoDeCompra,
  LineaCalculada,
  SalidaDeRegistrarCompra,
} from "./registrar-compra-tipos";

/**
 * Las piezas de «Comprar y recibir» que no son el hilo del caso de uso: lo que ya había hecho una compra repetida, lo que se decide de la factura antes de
 * escribir, escribir la factura con su conciliación atajo y la cuenta exacta de cada renglón.
 */

type R<S> = Resultado<S, ErrorDeCompras>;

const registroDePartes = crearRegistroDePartes();

/** Lo que ya había hecho una compra repetida: sus ids y los mismos avisos, sin escribir nada. */
export async function salidaDeLoYaHecho(
  tx: TxDeCompras,
  empresaId: EmpresaId,
  recepcionId: string,
): Promise<SalidaDeRegistrarCompra> {
  const lineas = await tx.recepciones.lineasDe(empresaId, recepcionId);
  const movimientos = [
    ...new Set(lineas.flatMap((l) => (l.movimientoId === null ? [] : [l.movimientoId]))),
  ];
  const comprobante = await tx.comprobantesDeProveedor.delaRecepcion(empresaId, recepcionId);
  const avisos: AvisoDeCompra[] = [];
  if (comprobante !== null) {
    if (comprobante.letraNoEsperada) {
      const ficha = await tx.fichasDeCompra.obtener(empresaId, comprobante.proveedorId);
      avisos.push({ tipo: "LETRA_NO_ESPERADA", esperada: ficha?.letraEsperada ?? "" });
    }
    const calculado = leerImporte(comprobante.totalCalculado);
    const impreso = leerImporte(comprobante.totalSegunFactura);
    if (calculado !== null && impreso !== null && !totalCoincide(calculado, impreso)) {
      avisos.push({ tipo: "TOTAL_NO_COINCIDE" });
    }
  }
  const pago =
    comprobante === null ? null : await tx.pagosDeProveedor.vigenteDe(empresaId, comprobante.id);
  return {
    recepcionId,
    comprobanteId: comprobante?.id ?? null,
    pagoId: pago?.id ?? null,
    movimientos,
    yaExistia: true,
    avisos,
  };
}

export type FacturaPreparada = Readonly<{
  calculado: ComprobanteCalculado;
  avisos: readonly AvisoDeCompra[];
  letraNoEsperada: boolean;
  cuit: string | null;
  razonSocial: string;
  asignaciones: readonly Readonly<{ lineaDeFactura: number; renglon: number; cantidad: string }>[];
}>;

/**
 * Todo lo que se decide de la factura ANTES de escribir nada: el punto de venta de la ficha, el CUIT del proveedor (en la primera factura se guarda en su ficha
 * del directorio), la letra esperada (avisa y no frena), las cuentas del comprobante (el total del papel que no coincide avisa y no frena) y el reparto de la
 * conciliación atajo.
 */
export async function prepararFactura(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: DependenciasDeCompras,
  proveedor: Readonly<{
    id: string;
    nombre: string | null;
    apellido: string | null;
    documento: Readonly<{ tipo: string; numero: string }> | null;
    version: number;
  }>,
  factura: FacturaPedida,
  lineas: readonly LineaCalculada[],
  condicionDeLaEmpresa: CondicionDeIvaDeLaEmpresa | null,
): Promise<R<FacturaPreparada>> {
  const { empresaId } = contexto;
  const ficha = await tx.fichasDeCompra.obtener(empresaId, proveedor.id);
  if (
    ficha === null ||
    !ficha.puntosDeVenta.some((p) => p.numero === factura.puntoDeVenta && p.activo)
  ) {
    return err("PUNTO_DE_VENTA_NO_DECLARADO");
  }
  const recibidas = new Map(lineas.map((l, i) => [i + 1, l.cantidadEnStock] as const));
  const reparto = repartirConciliacionDeAtajo(factura.lineas, recibidas);
  if (!reparto.ok) return reparto;
  const calculado = calcularComprobante({
    tipo: factura.tipo,
    lineas: factura.lineas.map((l) => ({
      cantidadFacturada: l.cantidadFacturada,
      precioNeto: l.precioNeto,
      alicuota: l.alicuota,
    })),
    tributos: tributosDeLaPantalla(factura.percepciones),
    totalSegunFactura: factura.totalSegunFactura,
    condicionDeLaEmpresa,
  });
  if (!calculado.ok) return calculado;

  // El CUIT: en la primera factura es obligatorio y se guarda en la parte; si ya tiene uno y la factura trae otro, no se pisa.
  let cuit = proveedor.documento?.tipo === "CUIT" ? proveedor.documento.numero : null;
  if (proveedor.documento === null && factura.cuitDelProveedor === null) {
    return err("CUIT_REQUERIDO_EN_PRIMERA_FACTURA");
  }
  if (factura.cuitDelProveedor !== null) {
    const completado = await registroDePartes.completarDocumentoEnTx(
      tx,
      contexto,
      dependencias.reglas,
      {
        parteId: proveedor.id,
        documento: { tipo: "CUIT", numero: factura.cuitDelProveedor },
        ...(factura.condicionIva === null ? {} : { condicionIva: factura.condicionIva }),
        versionEsperada: proveedor.version,
      },
    );
    if (!completado.ok) {
      return err(
        completado.error === "PARTE_CON_OTRO_DOCUMENTO"
          ? "PROVEEDOR_CON_OTRO_DOCUMENTO"
          : completado.error,
      );
    }
    if (proveedor.documento === null) cuit = factura.cuitDelProveedor;
  }

  const letraNoEsperada = esLetraNoEsperada(ficha.letraEsperada, factura.tipo);
  const avisos: AvisoDeCompra[] = [];
  if (letraNoEsperada)
    avisos.push({ tipo: "LETRA_NO_ESPERADA", esperada: ficha.letraEsperada ?? "" });
  if (!calculado.valor.totalCoincide) avisos.push({ tipo: "TOTAL_NO_COINCIDE" });
  return ok({
    calculado: calculado.valor,
    avisos,
    letraNoEsperada,
    cuit,
    razonSocial: razonSocialDeLaParte(proveedor.nombre, proveedor.apellido),
    asignaciones: reparto.valor,
  });
}

/** Escribe el comprobante, sus líneas, importes por alícuota y tributos, y la conciliación atajo con sus asignaciones. Devuelve el id del comprobante. */
export async function guardarFactura(
  tx: TxDeCompras,
  datos: Readonly<{
    empresaId: EmpresaId;
    persona: PersonaId;
    recepcionId: string;
    proveedorId: string;
    nivel: NivelDeCompra;
    clave: string;
    huella: string;
    factura: FacturaPedida;
    lineas: readonly LineaCalculada[];
    preparada: FacturaPreparada;
  }>,
): Promise<string> {
  const { empresaId, factura, preparada } = datos;
  const c = preparada.calculado;
  const comprobanteId = await tx.comprobantesDeProveedor.insertar(empresaId, {
    proveedorId: datos.proveedorId,
    clase: claseDeComprobante(factura.tipo),
    tipo: factura.tipo,
    puntoDeVenta: factura.puntoDeVenta,
    numero: factura.numero,
    fechaDelComprobante: factura.fecha,
    fechaDeVencimientoDePago: factura.vencimientoDePago,
    netoGravado: c.netoGravado,
    noGravado: c.noGravado,
    exento: c.exento,
    iva: c.iva,
    tributosTotal: c.tributosTotal,
    creditoFiscalComputable: c.creditoFiscalComputable,
    totalCalculado: c.totalCalculado,
    totalSegunFactura: c.totalSegunFactura,
    proveedorCuit: preparada.cuit,
    proveedorRazonSocial: preparada.razonSocial,
    letraNoEsperada: preparada.letraNoEsperada,
    nivel: datos.nivel,
    esAtajo: true,
    clave: datos.clave,
    huella: datos.huella,
    registradoPor: datos.persona,
  });
  if (comprobanteId === undefined) {
    throw new Error(
      "el comprobante chocó con una restricción única que no es la clave ni el duplicado",
    );
  }
  await tx.detalleDeComprobantes.insertarLineas(
    empresaId,
    comprobanteId,
    factura.lineas.map((l, i) => {
      const renglon = datos.lineas[l.renglon - 1] as LineaCalculada;
      const calculada = c.lineas[i];
      if (calculada === undefined)
        throw new Error("el comprobante calculado no tiene todas las líneas");
      return {
        numero: i + 1,
        descripcion: renglon.producto.nombre,
        unidad: renglon.producto.unidadBaseId,
        cantidadFacturada: l.cantidadFacturada,
        precioNeto: l.precioNeto,
        alicuota: calculada.alicuota,
        netoDeLinea: calculada.netoDeLinea,
        ivaDeLinea: calculada.ivaDeLinea,
        recepcionId: datos.recepcionId,
        lineaDeRecepcion: l.renglon,
      };
    }),
  );
  await tx.detalleDeComprobantes.insertarImportes(empresaId, comprobanteId, c.importesPorAlicuota);
  await tx.detalleDeComprobantes.insertarTributos(
    empresaId,
    comprobanteId,
    c.tributos.map((t, i) => ({
      numero: i + 1,
      tipo: t.tipo,
      descripcion: t.descripcion,
      baseImponible: t.baseImponible,
      alicuota: t.alicuota,
      importe: t.importe,
    })),
  );
  const conciliacionId = await tx.conciliacionesDeCompra.insertarConciliacion(empresaId, {
    acto: "CONCILIACION",
    anulaA: null,
    comprobanteId,
    esAtajo: true,
    nivel: datos.nivel,
    clave: claveDeLaConciliacionDeAtajo(datos.recepcionId),
    registradoPor: datos.persona,
  });
  if (conciliacionId === undefined) {
    throw new Error("la conciliación chocó con una restricción única que no es su clave");
  }
  await tx.conciliacionesDeCompra.insertarAsignaciones(
    empresaId,
    { id: conciliacionId, acto: "CONCILIACION", comprobanteId },
    preparada.asignaciones.map((a, i) => ({
      numero: i + 1,
      lineaDeComprobante: a.lineaDeFactura,
      recepcionId: datos.recepcionId,
      lineaDeRecepcion: a.renglon,
      cantidad: a.cantidad,
    })),
  );
  return comprobanteId;
}

/** Valida el producto y la presentación de un renglón y hace su cuenta exacta (`calcularLinea`). */
export async function calcularRenglon(
  tx: TxDeCompras,
  empresaId: EmpresaId,
  renglon: RenglonDeCompra,
  alicuotaDeIvaEnElCosto: AlicuotaDeCompra | null = null,
): Promise<R<LineaCalculada>> {
  const producto = await tx.productosParaCompras.bloquearCompartido(empresaId, renglon.productoId);
  if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
  if (!producto.activo || !esClaseComprable(producto.claseDeUso))
    return err("PRODUCTO_NO_COMPRABLE");
  let presentacion = null;
  if (renglon.presentacionId !== null) {
    presentacion = await tx.presentacionesDeProducto.obtener(empresaId, renglon.presentacionId);
    if (presentacion === null || presentacion.productoId !== producto.id || !presentacion.activa) {
      return err("PRESENTACION_NO_ENCONTRADA");
    }
  }
  const cuenta = calcularLinea({
    unidadBase: producto.unidadBaseId as CodigoDeUnidad,
    presentacion:
      presentacion === null
        ? null
        : { cantidadEnBase: presentacion.cantidad, dePesoVariable: presentacion.dePesoVariable },
    unidadDeCompra: renglon.unidadDeCompraId,
    cantidadDeCompra: renglon.cantidad,
    pesoReal: renglon.pesoReal,
    precioPor: renglon.precioPor,
    unidadDePrecio: renglon.unidadDePrecioId,
    precio: renglon.precio,
    alicuotaDeIvaEnElCosto,
  });
  if (!cuenta.ok) return cuenta;
  return ok({
    renglon,
    producto: { id: producto.id, nombre: producto.nombre, unidadBaseId: producto.unidadBaseId },
    dePesoVariable: presentacion?.dePesoVariable ?? false,
    cantidadEnStock: cuenta.valor.cantidadEnStock,
    importe: cuenta.valor.importe,
    costoPorUnidadDeStock: cuenta.valor.costoPorUnidadDeStock,
  });
}

/**
 * La condición de la empresa frente al IVA, solo cuando hace falta (una factura con IVA discriminado: una A): sin factura o con una B o C no se lee y es `null`.
 * Si hace falta y no se puede leer, `CONDICION_DE_IVA_NO_DISPONIBLE`: la compra no se registra (cierra, no supone; DEC-0322).
 */
export async function leerCondicionDeIva(
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  dependencias: Pick<DependenciasDeCompras, "ivaDeLaEmpresa">,
  factura: FacturaPedida | null,
): Promise<R<CondicionDeIvaDeLaEmpresa | null>> {
  if (factura === null || !discriminaIva(factura.tipo)) return ok(null);
  const condicion = await dependencias.ivaDeLaEmpresa.condicion(tx, contexto);
  return condicion === null ? err("CONDICION_DE_IVA_NO_DISPONIBLE") : ok(condicion);
}

/**
 * La cuenta de cada renglón (`calcularRenglon`). Si la compra trae factura, el IVA que entra al costo de un renglón sale de la línea de la factura que lo cubre,
 * por la regla única del dominio (`alicuotaQueEntraAlCosto`): inscripto, neto; monotributista o exento, con IVA incluido; B o C, el importe de la línea.
 */
export async function calcularRenglones(
  tx: TxDeCompras,
  empresaId: EmpresaId,
  renglones: readonly RenglonDeCompra[],
  factura: FacturaPedida | null,
  condicion: CondicionDeIvaDeLaEmpresa | null,
): Promise<R<LineaCalculada[]>> {
  const lineas: LineaCalculada[] = [];
  for (const [indice, renglon] of renglones.entries()) {
    const delaFactura = factura?.lineas.find((l) => l.renglon === indice + 1)?.alicuota ?? null;
    const alicuota =
      factura === null
        ? ok(null)
        : alicuotaQueEntraAlCosto(
            condicion,
            factura.tipo,
            delaFactura !== null && esAlicuotaDeCompra(delaFactura) ? delaFactura : null,
          );
    if (!alicuota.ok) return alicuota;
    const calculada = await calcularRenglon(tx, empresaId, renglon, alicuota.valor);
    if (!calculada.ok) return calculada;
    lineas.push(calculada.valor);
  }
  return ok(lineas);
}

/** Cuándo se hizo la compra: ausente es `ahora`; un pedido tiene que ser una fecha válida y no futura (`FECHA_INVALIDA`). */
export function leerHechoEn(pedido: unknown, ahora: Date): R<Date> {
  if (pedido === undefined) return ok(ahora);
  return pedido instanceof Date &&
    !Number.isNaN(pedido.getTime()) &&
    pedido.getTime() <= ahora.getTime()
    ? ok(pedido)
    : err("FECHA_INVALIDA");
}

/** El número de la factura no puede estar ya cargado para ese proveedor (duplicado único): `COMPROBANTE_YA_REGISTRADO` con el id del que ganó. */
export async function exigirFacturaNueva(
  tx: TxDeCompras,
  empresaId: EmpresaId,
  proveedorId: string,
  factura: FacturaPedida,
): Promise<R<null>> {
  const repetida = await tx.comprobantesDeProveedor.porDuplicado(
    empresaId,
    proveedorId,
    factura.tipo,
    factura.puntoDeVenta,
    factura.numero,
  );
  return repetida === null
    ? ok(null)
    : err({ error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: repetida.id });
}

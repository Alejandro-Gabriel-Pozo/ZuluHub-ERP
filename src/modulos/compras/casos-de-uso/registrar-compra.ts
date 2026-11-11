import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  sucursalId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { crearDirectorioDePartes, crearRegistroDePartes } from "../../clientes/publico";
import { esClaseComprable } from "../../catalogo/publico";
import { calcularLinea } from "../dominio/calcular-linea";
import {
  calcularComprobante,
  esLetraNoEsperada,
  totalCoincide,
  type ComprobanteCalculado,
} from "../dominio/comprobante";
import {
  camposDeHuellaDeFactura,
  leerFactura,
  razonSocialDeLaParte,
  repartirConciliacionDeAtajo,
  tributosDeLaPantalla,
  type FacturaPedida,
} from "../dominio/factura";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import { camposDeHuellaDePago, leerPago, type PagoPedido } from "../dominio/pago";
import { leerImporte } from "../dominio/decimal";
import { esUuid } from "../dominio/identificadores";
import { claseDeComprobante, PERILLA_DEL_NIVEL, type NivelDeCompra } from "../dominio/niveles";
import {
  claveDeLaConciliacionDeAtajo,
  claveDeLaEntradaDeStock,
  claveDelPagoDeLaCompra,
  elegirDepositoDeLaCompra,
  huellaDeLaCompra,
  leerRemito,
  leerRenglonesDeCompra,
  origenDeLaEntradaDeStock,
  type RenglonDeCompra,
  type Remito,
} from "../dominio/registrar-compra";
import type { LineaDeRecepcion } from "../persistencia/repositorio-de-recepciones";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();
const registroDePartes = crearRegistroDePartes();

export type EntradaDeRegistrarCompra = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia de la compra (D136). */
  clave: string;
  sucursalId: string;
  proveedorId: string;
  /** El depósito donde entra la mercadería; sin elegir, el único depósito normal activo de la sucursal (S-4). */
  depositoId?: string | null | undefined;
  /** Cuándo llegó la mercadería; por defecto, el `ahora` del contexto. Nunca en el futuro. */
  hechoEn?: Date | undefined;
  remito?: Readonly<{ puntoDeVenta: number; numero: number; fecha: string }> | null | undefined;
  renglones: readonly Readonly<{
    productoId: string;
    presentacionId?: string | null | undefined;
    unidadDeCompraId: string;
    cantidad: string;
    pesoReal?: string | null | undefined;
    precioPor: string;
    unidadDePrecioId?: string | null | undefined;
    precio?: string | null | undefined;
  }>[];
  /**
   * La factura que llega con la mercadería (N2). Solo cuando el nivel de la empresa es `CON_COMPROBANTE`. Las cantidades y precios de sus líneas van en la
   * unidad base del producto (ver `dominio/factura.ts`).
   */
  factura?: unknown;
  /** El pago de la factura, si ya se pagó (D142): `{ fechaDePago, medio }`. Pide `comprobantes_de_proveedor.pagar` y que la compra traiga factura. No mueve la caja. */
  pago?: unknown;
}>;

export type AvisoDeCompra =
  | Readonly<{ tipo: "LETRA_NO_ESPERADA"; esperada: string }>
  | Readonly<{ tipo: "TOTAL_NO_COINCIDE" }>;

export type SalidaDeRegistrarCompra = Readonly<{
  recepcionId: string;
  /** `null` si la compra no trae factura. */
  comprobanteId: string | null;
  /** `null` si la compra no se pagó. */
  pagoId: string | null;
  /** Los movimientos de stock que dejó la compra (uno por depósito); vacío si nada controlaba stock. */
  movimientos: readonly string[];
  /** `true`: la misma compra ya estaba registrada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
  avisos: readonly AvisoDeCompra[];
}>;

/** Una línea ya calculada, lista para guardarse. */
type LineaCalculada = Readonly<{
  renglon: RenglonDeCompra;
  producto: Readonly<{ id: string; nombre: string; unidadBaseId: string }>;
  dePesoVariable: boolean;
  cantidadEnStock: string;
  importe: string | null;
  costoPorUnidadDeStock: string | null;
}>;

/**
 * «Comprar y recibir» (E9 §3.5, N1): una recepción con sus líneas, la entrada de stock y la oferta del proveedor, en UNA transacción (todo o nada: un error de
 * stock revierte la compra entera). Guard `recepciones.registrar` y, si algún renglón entra a stock, también `stock.registrar_entrada`; la sucursal tiene que
 * estar en el alcance. Repetición (`CLAVE_DE_IDEMPOTENCIA`): misma clave y misma huella devuelve lo hecho con `yaExistia` sin escribir ni auditar; misma clave y
 * otro contenido, `CLAVE_REUTILIZADA`; el MISMO remito del mismo proveedor con otra clave, `REMITO_YA_REGISTRADO` con el id de la ganadora (el primer hecho
 * manda). El peso variable sin peso real no se confirma, y lo que entra al stock es el peso real. Sin stock activo o con un artículo no controlado, la compra se
 * registra sin entrada y sin error (S-9).
 */
export function armarRegistrarCompra(dependencias: DependenciasDeCompras) {
  return async function registrarCompra(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarCompra,
  ): Promise<R<SalidaDeRegistrarCompra>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave)) return err("IDENTIFICADOR_INVALIDO");
    if (!esUuid(entrada.sucursalId) || !esUuid(entrada.proveedorId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    if (
      entrada.depositoId !== undefined &&
      entrada.depositoId !== null &&
      !esUuid(entrada.depositoId)
    ) {
      return err("DEPOSITO_NO_ENCONTRADO");
    }
    let hechoEn = contexto.ahora;
    if (entrada.hechoEn !== undefined) {
      if (
        !(entrada.hechoEn instanceof Date) ||
        Number.isNaN(entrada.hechoEn.getTime()) ||
        entrada.hechoEn.getTime() > contexto.ahora.getTime()
      ) {
        return err("FECHA_INVALIDA");
      }
      hechoEn = entrada.hechoEn;
    }
    let remito: Remito | null = null;
    if (entrada.remito !== undefined && entrada.remito !== null) {
      const leido = leerRemito(entrada.remito);
      if (!leido.ok) return leido;
      remito = leido.valor;
    }
    const renglones = leerRenglonesDeCompra(entrada.renglones);
    if (!renglones.ok) return renglones;
    let factura: FacturaPedida | null = null;
    if (entrada.factura !== undefined && entrada.factura !== null) {
      const leida = leerFactura(entrada.factura);
      if (!leida.ok) return leida;
      factura = leida.valor;
    }
    let pago: PagoPedido | null = null;
    if (entrada.pago !== undefined && entrada.pago !== null) {
      if (factura === null) return err("PAGO_REQUIERE_FACTURA");
      const leido = leerPago(entrada.pago, contexto.ahora);
      if (!leido.ok) return leido;
      pago = leido.valor;
    }
    const huella = huellaDeLaCompra({
      sucursalId: entrada.sucursalId,
      proveedorId: entrada.proveedorId,
      depositoId: entrada.depositoId ?? null,
      hechoEn: entrada.hechoEn === undefined ? null : entrada.hechoEn.toISOString(),
      remito,
      renglones: renglones.valor,
      factura: factura === null ? null : camposDeHuellaDeFactura(factura),
      pago: pago === null ? null : [pago.fechaDePago, pago.medio],
    });

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeRegistrarCompra>> => {
          const acciones: [ClaveAccion, ...ClaveAccion[]] = ["recepciones.registrar"];
          const permiso = await autorizar(tx, contexto, dependencias.reglas, acciones);
          if (!permiso.ok) return permiso;
          if (factura !== null) {
            const deLaFactura = await autorizar(tx, contexto, dependencias.reglas, [
              "comprobantes_de_proveedor.registrar",
            ]);
            if (!deLaFactura.ok) return deLaFactura;
          }
          if (pago !== null) {
            const dePago = await autorizar(tx, contexto, dependencias.reglas, [
              "comprobantes_de_proveedor.pagar",
            ]);
            if (!dePago.ok) return dePago;
          }
          const sucursal = sucursalId(entrada.sucursalId);
          const alcance = await exigirAlcanceDeSucursal(tx, contexto, sucursal);
          if (!alcance.ok) return alcance;
          const fila = await tx.sucursales.obtener(empresaId, sucursal);
          if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
          if (!fila.activa) return err("SUCURSAL_INACTIVA");

          // 1. Repetición: por la clave (el mismo gesto) y por el remito (el primer hecho manda, aunque cambie la clave).
          const previa = await tx.recepciones.porClave(empresaId, entrada.clave);
          if (previa !== null) {
            if (decidirPorHuella(previa.huella, huella) !== "REPETIDA")
              return err("CLAVE_REUTILIZADA");
            return ok(await salidaDeLoYaHecho(tx, empresaId, previa.id));
          }
          if (remito !== null) {
            const igual = await tx.recepciones.porRemito(
              empresaId,
              entrada.proveedorId,
              remito.puntoDeVenta,
              remito.numero,
            );
            if (igual !== null)
              return err({ error: "REMITO_YA_REGISTRADO", recepcionId: igual.id });
          }

          // 2. El proveedor y el nivel con que nace la compra.
          const proveedor = await directorio.parteParaOperacion(
            tx,
            empresaId,
            entrada.proveedorId,
            "PROVEEDOR",
          );
          if (!proveedor.ok) return err("PROVEEDOR_NO_ENCONTRADO");
          const configuracion = await tx.configuracionDeCompras.leer(empresaId);
          const perilla = PERILLA_DEL_NIVEL[configuracion.nivel];
          if (perilla !== null) return err({ error: "FUNCION_NO_INCLUIDA", perilla });
          if (factura !== null && configuracion.nivel !== "CON_COMPROBANTE") {
            return err("FACTURA_NO_CORRESPONDE_AL_NIVEL");
          }
          if (factura !== null) {
            const repetida = await tx.comprobantesDeProveedor.porDuplicado(
              empresaId,
              proveedor.valor.id,
              factura.tipo,
              factura.puntoDeVenta,
              factura.numero,
            );
            if (repetida !== null) {
              return err({ error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: repetida.id });
            }
          }

          // 3. Las líneas: producto, presentación, cuenta exacta.
          const lineas: LineaCalculada[] = [];
          for (const renglon of renglones.valor) {
            const calculada = await calcularRenglon(tx, empresaId, renglon);
            if (!calculada.ok) return calculada;
            lineas.push(calculada.valor);
          }

          const preparada =
            factura === null
              ? null
              : await prepararFactura(tx, contexto, dependencias, proveedor.valor, factura, lineas);
          if (preparada !== null && !preparada.ok) return preparada;

          // 4. Stock: qué renglones entran (los de artículos controlados con stock activo) y a qué depósito.
          const controla = await dependencias.stock.articulosDeVenta.controla(
            tx,
            contexto,
            lineas.map((l) => l.producto.id),
          );
          const entran = lineas.filter((l) => controla.get(l.producto.id)?.controla === true);
          let depositoId: string | null = null;
          if (entran.length > 0) {
            const stock = await autorizar(tx, contexto, dependencias.reglas, [
              "stock.registrar_entrada",
            ]);
            if (!stock.ok) return stock;
            const candidatos = (
              await tx.depositos.listar(empresaId, {
                alcance: [sucursal],
                sucursalId: sucursal,
                soloActivos: true,
              })
            )
              .filter((d) => d.uso === "NORMAL")
              .map((d) => d.id);
            const elegido = elegirDepositoDeLaCompra(candidatos, entrada.depositoId ?? null);
            if (!elegido.ok) return elegido;
            depositoId = elegido.valor;
          }

          // 5. La recepción y, con ella, la entrada de stock y las líneas.
          const recepcionId = await tx.recepciones.insertar(empresaId, {
            sucursalId: sucursal,
            proveedorId: proveedor.valor.id,
            nivel: configuracion.nivel,
            esAtajo: true,
            remito,
            hechoEn,
            clave: entrada.clave,
            huella,
            registradoPor: persona,
          });
          if (recepcionId === undefined) {
            throw new Error(
              "la recepción chocó con una restricción única que no es la clave ni el remito",
            );
          }
          const movimientos: string[] = [];
          let movimientoId: string | null = null;
          if (depositoId !== null) {
            const entrada_ = await dependencias.stock.entradaPorOrigen.registrarEntrada(
              tx,
              contexto,
              {
                clave: claveDeLaEntradaDeStock(recepcionId, depositoId),
                origen: {
                  tipo: "RECEPCION",
                  id: origenDeLaEntradaDeStock(recepcionId, depositoId),
                },
                accion: "stock.registrar_entrada",
                depositoId,
                motivo: "COMPRA",
                hechoEn,
                renglones: entran.map((l) => ({
                  productoId: l.producto.id,
                  cantidad: l.cantidadEnStock,
                  unidadId: l.producto.unidadBaseId,
                  ...(l.costoPorUnidadDeStock === null
                    ? {}
                    : { costoUnitario: l.costoPorUnidadDeStock }),
                })),
              },
            );
            if (!entrada_.ok) return entrada_;
            movimientoId = entrada_.valor.movimientoId;
            movimientos.push(movimientoId);
          }
          const guardadas: LineaDeRecepcion[] = lineas.map((l, i) => {
            const entra = controla.get(l.producto.id)?.controla === true;
            return {
              numero: i + 1,
              productoId: l.producto.id,
              presentacionId: l.renglon.presentacionId,
              unidadDeCompraId: l.renglon.unidadDeCompraId,
              cantidadDeCompra: l.renglon.cantidad,
              dePesoVariable: l.dePesoVariable,
              pesoReal: l.renglon.pesoReal,
              cantidadEnStock: l.cantidadEnStock,
              precioPorTipo: l.renglon.precio === null ? null : l.renglon.precioPor,
              unidadDePrecioId: l.renglon.precio === null ? null : l.renglon.unidadDePrecioId,
              precio: l.renglon.precio,
              importe: l.importe,
              costoPorUnidadDeStock: l.costoPorUnidadDeStock,
              depositoId: entra ? depositoId : null,
              movimientoId: entra ? movimientoId : null,
            };
          });
          await tx.recepciones.insertarLineas(empresaId, recepcionId, guardadas);

          let comprobanteId: string | null = null;
          if (factura !== null && preparada !== null && preparada.ok) {
            const guardado = await guardarFactura(tx, {
              empresaId,
              persona,
              recepcionId,
              proveedorId: proveedor.valor.id,
              nivel: configuracion.nivel,
              clave: entrada.clave,
              huella,
              factura,
              lineas,
              preparada: preparada.valor,
            });
            comprobanteId = guardado;
          }
          let pagoId: string | null = null;
          if (pago !== null && comprobanteId !== null && preparada !== null && preparada.ok) {
            const importe = preparada.valor.calculado.totalSegunFactura;
            const nuevo = await tx.pagosDeProveedor.insertar(empresaId, {
              comprobanteId,
              fechaDePago: pago.fechaDePago,
              medio: pago.medio,
              importe,
              clave: claveDelPagoDeLaCompra(recepcionId),
              huella: huellaDeComando(
                "declarar_pago",
                [comprobanteId, ...camposDeHuellaDePago(pago, importe)],
                [],
              ),
              registradoPor: persona,
            });
            if (nuevo === undefined) {
              throw new Error(
                "el pago chocó con una restricción única que no es su clave ni el pago vigente",
              );
            }
            pagoId = nuevo;
          }

          // 6. Lo que cobró el proveedor: la compra más nueva gana.
          for (const l of lineas) {
            if (l.renglon.precio === null || l.costoPorUnidadDeStock === null) continue;
            await tx.ofertasDeProveedor.registrar(empresaId, {
              proveedorId: proveedor.valor.id,
              productoId: l.producto.id,
              presentacionId: l.renglon.presentacionId,
              precioPorTipo: l.renglon.precioPor,
              unidadDePrecioId: l.renglon.unidadDePrecioId,
              ultimoPrecio: l.renglon.precio,
              ultimoCostoPorUnidadDeStock: l.costoPorUnidadDeStock,
              ultimaCompraId: recepcionId,
              ultimaCompraEn: hechoEn,
            });
          }

          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "COMPRA_REGISTRADA",
            entidad: "recepcion",
            entidadId: recepcionId,
            despues: {
              proveedorId: proveedor.valor.id,
              sucursalId: entrada.sucursalId,
              nivel: configuracion.nivel,
              renglones: lineas.length,
              comprobanteId,
              pagoId,
              movimientos,
            },
          });
          return ok({
            recepcionId,
            comprobanteId,
            pagoId,
            movimientos,
            yaExistia: false,
            avisos: preparada !== null && preparada.ok ? preparada.valor.avisos : [],
          });
        },
      ),
    );
  };
}

/** Lo que ya había hecho una compra repetida: sus ids y los mismos avisos, sin escribir nada. */
async function salidaDeLoYaHecho(
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

type FacturaPreparada = Readonly<{
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
async function prepararFactura(
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
async function guardarFactura(
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
  await tx.comprobantesDeProveedor.insertarLineas(
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
  await tx.comprobantesDeProveedor.insertarImportes(
    empresaId,
    comprobanteId,
    c.importesPorAlicuota,
  );
  await tx.comprobantesDeProveedor.insertarTributos(
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
  const conciliacionId = await tx.comprobantesDeProveedor.insertarConciliacion(empresaId, {
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
  await tx.comprobantesDeProveedor.insertarAsignaciones(
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
async function calcularRenglon(
  tx: TxDeCompras,
  empresaId: EmpresaId,
  renglon: RenglonDeCompra,
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

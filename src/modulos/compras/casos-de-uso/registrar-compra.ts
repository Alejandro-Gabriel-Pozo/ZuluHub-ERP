import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { esClaseComprable } from "../../catalogo/publico";
import { calcularLinea } from "../dominio/calcular-linea";
import { decidirPorHuella } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { PERILLA_DEL_NIVEL } from "../dominio/niveles";
import {
  claveDeLaEntradaDeStock,
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
}>;

export type AvisoDeCompra =
  | Readonly<{ tipo: "LETRA_NO_ESPERADA"; esperada: string }>
  | Readonly<{ tipo: "TOTAL_NO_COINCIDE" }>;

export type SalidaDeRegistrarCompra = Readonly<{
  recepcionId: string;
  /** `null` si la compra no trae factura. */
  comprobanteId: string | null;
  /** Los movimientos de stock que dejó la compra (uno por depósito); vacío si nada controlaba stock. */
  movimientos: readonly string[];
  /** `true`: la misma compra ya estaba registrada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
  avisos: readonly AvisoDeCompra[];
}>;

/** Una línea ya calculada, lista para guardarse. */
type LineaCalculada = Readonly<{
  renglon: RenglonDeCompra;
  producto: Readonly<{ id: string; unidadBaseId: string }>;
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
    const huella = huellaDeLaCompra({
      sucursalId: entrada.sucursalId,
      proveedorId: entrada.proveedorId,
      depositoId: entrada.depositoId ?? null,
      hechoEn: entrada.hechoEn === undefined ? null : entrada.hechoEn.toISOString(),
      remito,
      renglones: renglones.valor,
      factura: null,
      pago: null,
    });

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeRegistrarCompra>> => {
          const acciones: [ClaveAccion, ...ClaveAccion[]] = ["recepciones.registrar"];
          const permiso = await autorizar(tx, contexto, dependencias.reglas, acciones);
          if (!permiso.ok) return permiso;
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

          // 3. Las líneas: producto, presentación, cuenta exacta.
          const lineas: LineaCalculada[] = [];
          for (const renglon of renglones.valor) {
            const calculada = await calcularRenglon(tx, empresaId, renglon);
            if (!calculada.ok) return calculada;
            lineas.push(calculada.valor);
          }

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
              movimientos,
            },
          });
          return ok({
            recepcionId,
            comprobanteId: null,
            movimientos,
            yaExistia: false,
            avisos: [],
          });
        },
      ),
    );
  };
}

/** Lo que ya había hecho una compra repetida: sus ids, sin escribir nada. */
async function salidaDeLoYaHecho(
  tx: TxDeCompras,
  empresaId: EmpresaId,
  recepcionId: string,
): Promise<SalidaDeRegistrarCompra> {
  const lineas = await tx.recepciones.lineasDe(empresaId, recepcionId);
  const movimientos = [
    ...new Set(lineas.flatMap((l) => (l.movimientoId === null ? [] : [l.movimientoId]))),
  ];
  return { recepcionId, comprobanteId: null, movimientos, yaExistia: true, avisos: [] };
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
    producto: { id: producto.id, unidadBaseId: producto.unidadBaseId },
    dePesoVariable: presentacion?.dePesoVariable ?? false,
    cantidadEnStock: cuenta.valor.cantidadEnStock,
    importe: cuenta.valor.importe,
    costoPorUnidadDeStock: cuenta.valor.costoPorUnidadDeStock,
  });
}

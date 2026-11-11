import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import {
  calcularRenglon,
  guardarFactura,
  prepararFactura,
  salidaDeLoYaHecho,
} from "./registrar-compra-apoyo";
import type {
  EntradaDeRegistrarCompra,
  LineaCalculada,
  SalidaDeRegistrarCompra,
} from "./registrar-compra-tipos";
import { camposDeHuellaDeFactura, leerFactura, type FacturaPedida } from "../dominio/factura";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import { camposDeHuellaDePago, leerPago, type PagoPedido } from "../dominio/pago";
import { esUuid } from "../dominio/identificadores";
import { PERILLA_DEL_NIVEL } from "../dominio/niveles";
import {
  claveDeLaEntradaDeStock,
  claveDelPagoDeLaCompra,
  elegirDepositoDeLaCompra,
  huellaDeLaCompra,
  leerRemito,
  leerRenglonesDeCompra,
  origenDeLaEntradaDeStock,
  type Remito,
} from "../dominio/registrar-compra";
import type { LineaDeRecepcion } from "../persistencia/repositorio-de-recepciones";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();

/**
 * «Comprar y recibir» (E9 §3.5): una recepción con sus líneas, la entrada de stock, la oferta del proveedor y, con factura, su comprobante y conciliación,
 * en UNA transacción (todo o nada). Guard `recepciones.registrar` y, si algún renglón entra a stock, `stock.registrar_entrada`; la sucursal en el alcance.
 * Repetición (`CLAVE_DE_IDEMPOTENCIA`): misma clave y huella devuelve lo hecho con `yaExistia` sin escribir ni auditar; misma clave y otro contenido,
 * `CLAVE_REUTILIZADA`; el MISMO remito del mismo proveedor con otra clave, `REMITO_YA_REGISTRADO` (el primer hecho manda). Peso variable sin peso real no se
 * confirma; sin stock activo o con un artículo no controlado se registra sin entrada y sin error (S-9).
 */
function armarRegistro(dependencias: DependenciasDeCompras, conFactura: boolean) {
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
    if (conFactura && factura === null) return err("FACTURA_REQUERIDA");
    if (
      !conFactura &&
      (factura !== null || (entrada.pago !== undefined && entrada.pago !== null))
    ) {
      return err("COMPRA_SIMPLE_NO_LLEVA_FACTURA");
    }
    let pago: PagoPedido | null = null;
    if (entrada.pago !== undefined && entrada.pago !== null) {
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

/**
 * «Comprar y recibir» sin factura (N1; guard `recepciones.registrar`): la compra, su entrada de stock y la oferta del proveedor. Si llega una factura o un pago es
 * `COMPRA_SIMPLE_NO_LLEVA_FACTURA`: para eso está `registrarCompraConFactura`.
 */
export const armarRegistrarCompra = (dependencias: DependenciasDeCompras) =>
  armarRegistro(dependencias, false);

/**
 * «Comprar y recibir» con la factura del proveedor (N2; guard `comprobantes_de_proveedor.registrar` además de `recepciones.registrar`, y `comprobantes_de_proveedor.pagar`
 * si viaja el pago). Exige la factura (`FACTURA_REQUERIDA`) y que el nivel de la empresa sea `CON_COMPROBANTE` (`FACTURA_NO_CORRESPONDE_AL_NIVEL`). Misma repetición
 * que `registrarCompra`: la clave y la huella del pedido completo, y el duplicado único de la factura.
 */
export const armarRegistrarCompraConFactura = (dependencias: DependenciasDeCompras) =>
  armarRegistro(dependencias, true);

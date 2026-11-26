import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { camposDeHuellaDeFactura, leerFactura } from "../dominio/factura";
import { decidirPorHuella, huellaDeComando } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import {
  claveDeLaConciliacionDelCambioDeComprobante,
  motivoDeAnulacionDesdeTexto,
} from "../dominio/registrar-compra";
import { anularElCargoDeLaFactura, asentarElCargoDeLaFactura } from "./cargo-de-la-factura";
import { autorizar, exigirAlcanceDeSucursal, traducir } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import { espejarLasConciliacionesDelAtajo } from "./espejo-del-atajo";
import type { ErrorDeCompras } from "./errores";
import { frenosDeLaFactura } from "./frenos-del-reemplazo";
import {
  exigirFacturaNueva,
  guardarFactura,
  leerCondicionDeIva,
  prepararFactura,
} from "./registrar-compra-apoyo";
import type { AvisoDeCompra } from "./registrar-compra-tipos";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();

export type EntradaDeCambiarElComprobanteDeLaCompra = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia del cambio. */
  clave: string;
  /** La compra (N2) cuya factura se cambia. */
  recepcionId: string;
  /** Por qué se cambia: queda en la anulación de la factura anterior (lo escribe quien la cambia; el sistema no inventa textos). */
  motivo: string;
  /** La factura nueva, como la de `registrarCompraConFactura`: cada línea dice a qué renglón de la compra corresponde. */
  factura: unknown;
}>;

export type SalidaDeCambiarElComprobanteDeLaCompra = Readonly<{
  comprobanteId: string;
  /** `true`: el mismo cambio ya estaba hecho (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
  avisos: readonly AvisoDeCompra[];
}>;

/**
 * «Cambiar el comprobante de la compra» (NOTAS-2b, N-F; N1/N2): el proveedor anuló la factura de una compra ya recibida y mandó otra. UNA operación atómica sobre una compra que YA tiene factura: anula la factura vigente con el motivo,
 * espeja su conciliación atajo y su cargo en el libro, registra la nueva (vínculo `reemplazaAId`, mismo proveedor) contra los MISMOS renglones recibidos con su propia conciliación atajo y su cargo, y audita `FACTURA_REEMPLAZADA`.
 * La recepción, la entrada de stock, el costo congelado y las ofertas NO se tocan (no usa `anularCompra`: por eso una compra ya consumida se puede cambiar). Con otro importe el costo congelado de lo recibido no se recalcula: lo confirmó el dueño el 26/11/2026 (P-1); si
 * hace falta se corrige con «Corregir lo recibido».
 * Orden de bloqueo: recepción → factura → (nota → pago → parte del libro, que toma `asentarElCargoDeLaFactura` al final). Ni `declararPago` ni las notas bloquean la recepción, así que no hay ciclo; `anularCompra` toma el mismo
 * orden (recepción → factura), de modo que cambiar y anular la compra a la vez se serializan por la recepción.
 * Guard: `comprobantes_de_proveedor.reemplazar`, `.anular` y `.registrar`; alcance sobre la sucursal de la compra. NO anula el pago, las notas ni otra conciliación: si la factura tiene alguno falla cerrado con el código del primero
 * (`COMPROBANTE_YA_PAGADO` con el id del pago, `COMPROBANTE_CONCILIADO`, `COMPROBANTE_CON_NOTA_DE_CREDITO`); solo la conciliación atajo de la propia compra se espeja. Una compra sin factura (`COMPROBANTE_NO_ENCONTRADO`) o anulada
 * (`RECEPCION_YA_ANULADA`) no se cambia. El número puede ser el mismo: la anterior se anula ANTES de registrar la nueva. Repetición: misma clave y mismo contenido devuelve la misma factura (`yaExistia`) sin escribir ni
 * auditar; otro contenido, `CLAVE_REUTILIZADA`; cambiar dos veces la misma factura, `FACTURA_YA_REEMPLAZADA` con el id de la vigente.
 */
export function armarCambiarElComprobanteDeLaCompra(dependencias: DependenciasDeCompras) {
  return async function cambiarElComprobanteDeLaCompra(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarElComprobanteDeLaCompra,
  ): Promise<R<SalidaDeCambiarElComprobanteDeLaCompra>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave) || !esUuid(entrada.recepcionId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    const leida = leerFactura(entrada.factura);
    if (!leida.ok) return leida;
    const factura = leida.valor;
    const huella = huellaDeComando(
      "cambiar_comprobante_de_la_compra",
      [entrada.recepcionId, ...camposDeHuellaDeFactura(factura)],
      [],
    );
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeCambiarElComprobanteDeLaCompra>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "comprobantes_de_proveedor.reemplazar",
            "comprobantes_de_proveedor.anular",
            "comprobantes_de_proveedor.registrar",
          ]);
          if (!permiso.ok) return permiso;
          const recepcion = await tx.recepciones.bloquear(empresaId, entrada.recepcionId);
          if (recepcion === null || !recepcion.esAtajo || recepcion.nivel !== "CON_COMPROBANTE") {
            return err("RECEPCION_NO_ENCONTRADA");
          }
          const alcance = await exigirAlcanceDeSucursal(
            tx,
            contexto,
            sucursalId(recepcion.sucursalId),
          );
          if (!alcance.ok) return alcance;
          const previa = await tx.comprobantesDeProveedor.porClave(empresaId, entrada.clave);
          if (previa !== null) {
            return previa.reemplazaAId !== null &&
              (await tx.comprobantesDeProveedor.recepcionIdDe(empresaId, previa.id)) ===
                recepcion.id &&
              decidirPorHuella(previa.huella, huella) === "REPETIDA"
              ? ok({ comprobanteId: previa.id, yaExistia: true, avisos: [] })
              : err("CLAVE_REUTILIZADA");
          }
          if (recepcion.estado === "ANULADA") return err("RECEPCION_YA_ANULADA");
          const vigente = await tx.comprobantesDeProveedor.delaRecepcion(empresaId, recepcion.id);
          if (vigente === null || vigente.clase !== "FACTURA") {
            return err("COMPROBANTE_NO_ENCONTRADO");
          }
          const original = await tx.comprobantesDeProveedor.bloquear(empresaId, vigente.id);
          if (original === null) return err("COMPROBANTE_NO_ENCONTRADO");
          if (original.estado === "ANULADO") return err("COMPROBANTE_ANULADO");

          // Lo que hay que deshacer antes (pago, otra conciliación, notas): el primero que se encuentre. La conciliación atajo de la propia compra se espeja.
          const frenos = await frenosDeLaFactura(tx, empresaId, original.id, true);
          if (frenos[0] !== undefined) return err(frenos[0].error);

          const anulada = await tx.comprobantesDeProveedor.anular(empresaId, original.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!anulada) throw new Error("la factura ya no estaba registrada bajo bloqueo");
          await espejarLasConciliacionesDelAtajo(tx, empresaId, persona, original);
          const espejo = await anularElCargoDeLaFactura(tx, contexto, dependencias, original.id);
          if (!espejo.ok) return espejo;

          // La nueva, contra lo ya recibido (no se vuelve a calcular nada de stock ni de costo).
          const proveedor = await directorio.parteParaOperacion(
            tx,
            empresaId,
            recepcion.proveedorId,
            "PROVEEDOR",
          );
          if (!proveedor.ok) return err("PROVEEDOR_NO_ENCONTRADO");
          const nueva = await exigirFacturaNueva(tx, empresaId, proveedor.valor.id, factura);
          if (!nueva.ok) return nueva;
          const recibidas = await tx.recepciones.lineasDe(empresaId, recepcion.id);
          const lineas = [];
          for (const l of recibidas) {
            const producto = await tx.productosParaCompras.obtener(empresaId, l.productoId);
            if (producto === null) throw new Error("el producto de la compra ya no existe");
            lineas.push({
              cantidadEnStock: l.cantidadEnStock,
              producto: {
                id: producto.id,
                nombre: producto.nombre,
                unidadBaseId: producto.unidadBaseId,
              },
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
            lineas,
            condicion.valor,
          );
          if (!preparada.ok) return preparada;
          const comprobanteId = await guardarFactura(tx, {
            empresaId,
            persona,
            recepcionId: recepcion.id,
            proveedorId: proveedor.valor.id,
            nivel: recepcion.nivel,
            clave: entrada.clave,
            huella,
            factura,
            lineas,
            preparada: preparada.valor,
            reemplazaAId: original.id,
            claveDeLaConciliacion: claveDeLaConciliacionDelCambioDeComprobante(
              recepcion.id,
              entrada.clave,
            ),
          });
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "FACTURA_REEMPLAZADA",
            entidad: "comprobante_de_proveedor",
            entidadId: original.id,
            antes: { estado: "REGISTRADO" },
            despues: {
              estado: "ANULADO",
              motivo: motivo.valor,
              reemplazadaPor: comprobanteId,
              compra: recepcion.id,
              fechaDeLaOriginal: original.fechaDelComprobante,
              fechaDeLaNueva: factura.fecha,
              mismoNumero:
                factura.tipo === original.tipo &&
                factura.puntoDeVenta === original.puntoDeVenta &&
                factura.numero === original.numero,
            },
          });
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "FACTURA_REGISTRADA",
            entidad: "comprobante_de_proveedor",
            entidadId: comprobanteId,
            despues: {
              proveedorId: proveedor.valor.id,
              nivel: recepcion.nivel,
              fechaDelComprobante: factura.fecha,
              lineas: factura.lineas.length,
              totalSegunFactura: preparada.valor.calculado.totalSegunFactura,
              compra: recepcion.id,
            },
          });
          // Al final: el libro toma el saldo del proveedor después del comprobante.
          const cargo = await asentarElCargoDeLaFactura(tx, contexto, dependencias, {
            comprobanteId,
            proveedorId: proveedor.valor.id,
            total: preparada.valor.calculado.totalSegunFactura,
            venceEl: factura.vencimientoDePago,
            sucursalId: recepcion.sucursalId,
          });
          if (!cargo.ok) return cargo;
          return ok({ comprobanteId, yaExistia: false, avisos: preparada.valor.avisos });
        },
      ),
    );
  };
}

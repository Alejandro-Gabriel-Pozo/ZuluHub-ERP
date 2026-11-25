import type { ContextoOperativo } from "../../../contexto/contexto";
import { fechaCivilDesdeTexto } from "../../../primitivas/tiempo/fecha-civil";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import { leerImporte, textoDeImporte } from "../dominio/decimal";
import type {
  CompraParaExportar,
  ComprobanteParaExportar,
  LineaParaExportar,
} from "../dominio/exportacion/datos";
import {
  FILAS_MAXIMAS_DE_LA_EXPORTACION,
  periodoDeLaExportacionValido,
  TAMANO_DE_TANDA_DE_LA_EXPORTACION,
} from "../dominio/exportacion/limites";
import { armarResumen } from "../dominio/exportacion/armar-hojas";
import { repartirConMayorResto } from "../dominio/exportacion/montos";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import type { CorreccionGuardada } from "../persistencia/repositorio-de-correcciones";
import type { FilaDeRecepcionParaExportar } from "../persistencia/repositorio-de-exportacion-de-compras";
import type { LineaDeRecepcion } from "../persistencia/repositorio-de-recepciones";
import { claveDeLinea, importesVigentes } from "./compras-por-lote";
import { autorizar } from "./comun";
import type { DependenciasDeCompras } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeCompras } from "./errores";

type R<S> = Resultado<S, ErrorDeCompras>;

export type EntradaDeExportarCompras = Readonly<{
  /** Fechas civiles `AAAA-MM-DD`, inclusive: el período que pidió la persona. */
  desde: string;
  hasta: string;
}>;

export type SalidaDeExportarCompras = Readonly<{
  compras: readonly CompraParaExportar[];
  desde: string;
  hasta: string;
}>;

const directorio = crearDirectorioDePartes();

/** El corte de la clasificación vigente: el fin del día de negocio en Argentina (UTC-3, sin horario de verano). */
const finDelDia = (fecha: string): number =>
  new Date(`${fecha}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000;

const centavos = (texto: string): bigint => {
  const v = leerImporte(texto);
  if (v === null) throw new Error(`Un importe de la base no es un decimal de pesos: ${texto}`);
  return v;
};

/**
 * Exportar las compras de un período a Excel (dueño, 25/11/2026): lee la Cabecera, el Detalle y lo que el Resumen necesita dentro de UNA transacción `serializable` (una foto: una
 * corrección que entra a mitad no deja un archivo que mezcla antes y después) y deja el registro de auditoría en esa misma transacción: quién, cuándo, qué período y cuántas filas, SIN
 * los datos. Es de LECTURA: repetirla da lo mismo y deja otro registro. No lee más de lo que el período y el alcance de sucursales de quien pide permiten, y por encima del tope
 * (`FILAS_MAXIMAS_DE_LA_EXPORTACION`) rechaza el pedido antes de leer el detalle. El archivo se genera DESPUÉS, fuera de la transacción, con lo que devuelve.
 *
 * Exige TODAS las acciones declaradas: `compras.exportar`, las dos de ver compras y `costos.ver` (el archivo lleva importes). Si el registro de auditoría falla, no sale nada.
 */
export function armarExportarCompras(
  dependencias: DependenciasDeCompras,
  /** El tope de filas; solo las pruebas lo cambian. */
  filasMaximas: number = FILAS_MAXIMAS_DE_LA_EXPORTACION,
) {
  return async function exportarCompras(
    contexto: ContextoOperativo,
    entrada: EntradaDeExportarCompras,
  ): Promise<R<SalidaDeExportarCompras>> {
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (
      !fechaCivilDesdeTexto(entrada.desde).ok ||
      !fechaCivilDesdeTexto(entrada.hasta).ok ||
      !periodoDeLaExportacionValido(entrada.desde, entrada.hasta)
    ) {
      return err("FECHA_INVALIDA");
    }
    return dependencias.transacciones.ejecutar(
      { contexto, aislamiento: "serializable" },
      async (tx): Promise<R<SalidaDeExportarCompras>> => {
        const permiso = await autorizar(
          tx,
          contexto,
          dependencias.reglas,
          accionesDeCaso(DECLARACIONES.exportarCompras),
        );
        if (!permiso.ok) return permiso;
        const empresa = contexto.empresaId;
        const alcance = await tx.autorizacion.sucursalesDelActor(contexto);
        const filtro = { sucursales: alcance, desde: entrada.desde, hasta: entrada.hasta };
        const cuantas = await tx.exportacionDeCompras.contar(empresa, filtro);
        if (
          cuantas.lineas > filasMaximas ||
          cuantas.cabeceras > filasMaximas
        ) {
          return err("EXPORTACION_DEMASIADO_GRANDE");
        }

        // 1. Las compras del período, de a tandas (las consultas por lote no crecen con el período).
        const filas: FilaDeRecepcionParaExportar[] = [];
        for (let despuesDe: { fechaNegocio: string; numero: number } | null = null; ; ) {
          const tanda = await tx.exportacionDeCompras.recepcionesDelPeriodo(
            empresa,
            filtro,
            despuesDe,
            TAMANO_DE_TANDA_DE_LA_EXPORTACION,
          );
          filas.push(...tanda);
          const ultima = tanda.at(-1);
          if (ultima === undefined || tanda.length < TAMANO_DE_TANDA_DE_LA_EXPORTACION) break;
          despuesDe = { fechaNegocio: ultima.fechaNegocio, numero: ultima.numero };
        }
        const comprobanteIds = [
          ...new Set(filas.flatMap((f) => (f.comprobanteId === null ? [] : [f.comprobanteId]))),
        ];

        // 2. Las facturas, sus pagos y TODAS las líneas que cada factura cubre (el reparto del abonado no depende del filtro).
        const facturas = new Map<string, ComprobanteParaExportar>();
        const cubiertas = await tx.exportacionDeCompras.lineasDeComprobantes(empresa, comprobanteIds);
        const idsDeRecepciones = [
          ...new Set([...filas.map((f) => f.id), ...cubiertas.map((c) => c.recepcionId)]),
        ];
        const pagos = await tx.exportacionDeCompras.pagosDeComprobantes(empresa, comprobanteIds);
        const comprobantes = new Map<string, ComprobanteGuardado & Readonly<{ recepcionId: string }>>();
        for (let i = 0; i < filas.length; i += TAMANO_DE_TANDA_DE_LA_EXPORTACION) {
          const parte = filas.slice(i, i + TAMANO_DE_TANDA_DE_LA_EXPORTACION).map((f) => f.id);
          for (const c of await tx.comprobantesDeProveedor.deVariasRecepciones(empresa, parte)) {
            comprobantes.set(c.recepcionId, c);
          }
        }
        for (const c of comprobantes.values()) {
          if (facturas.has(c.id)) continue;
          facturas.set(c.id, {
            id: c.id,
            tipo: c.tipo,
            puntoDeVenta: c.puntoDeVenta,
            numero: c.numero,
            fechaDelComprobante: c.fechaDelComprobante,
            netoGravado: c.netoGravado,
            noGravado: c.noGravado,
            exento: c.exento,
            iva: c.iva,
            tributosTotal: c.tributosTotal,
            totalCalculado: c.totalCalculado,
            totalSegunFactura: c.totalSegunFactura,
            proveedorCuit: c.proveedorCuit,
            estado: c.estado,
            pagos: pagos
              .filter((p) => p.comprobanteId === c.id)
              .map((p) => ({
                fechaDePago: p.fechaDePago,
                medio: p.medio,
                importe: p.importe,
                estado: p.estado,
              })),
          });
        }
        const razonSocial = new Map([...comprobantes.values()].map((c) => [c.recepcionId, c.proveedorRazonSocial]));

        // 3. Las líneas con su importe vigente, por tandas, y los datos de sus productos, presentaciones y unidades.
        const lineasPorRecepcion = new Map<string, (LineaDeRecepcion & Readonly<{ recepcionId: string }>)[]>();
        const importes = new Map<string, string | null>();
        const ultimas = new Map<string, CorreccionGuardada>();
        for (let i = 0; i < idsDeRecepciones.length; i += TAMANO_DE_TANDA_DE_LA_EXPORTACION) {
          const parte = idsDeRecepciones.slice(i, i + TAMANO_DE_TANDA_DE_LA_EXPORTACION);
          const r = await importesVigentes(tx, contexto, parte);
          for (const l of r.lineas) {
            const lista = lineasPorRecepcion.get(l.recepcionId) ?? [];
            lista.push(l);
            lineasPorRecepcion.set(l.recepcionId, lista);
          }
          for (const [k, v] of r.importes) importes.set(k, v);
          for (const [k, v] of r.ultimas) ultimas.set(k, v);
        }
        const todasLasLineas = [...lineasPorRecepcion.values()].flat();
        const productos = new Map(
          (
            await tx.productosParaCompras.deVarios(
              empresa,
              todasLasLineas.map((l) => l.productoId),
            )
          ).map((p) => [p.id, p]),
        );
        const presentaciones = new Map(
          (
            await tx.presentacionesDeProducto.obtenerVarias(
              empresa,
              todasLasLineas.flatMap((l) => (l.presentacionId === null ? [] : [l.presentacionId])),
            )
          ).map((p) => [p.id, p]),
        );
        const { codigos, clasificaciones } = await tx.exportacionDeCompras.datosDeProductos(
          empresa,
          [...productos.keys()],
        );
        const simbolos = await tx.exportacionDeCompras.simbolosDeUnidades();
        const nombres = await directorio.nombresParaMostrar(tx, empresa, [
          ...new Set(filas.map((f) => f.proveedorId)),
        ]);

        // 4. El abonado de cada factura repartido por el peso de TODAS sus líneas (centavos exactos, mayor resto).
        const abonadoDerivado = new Map<string, string | null>();
        for (const f of facturas.values()) {
          const vigente = f.pagos.find((p) => p.estado === "VIGENTE");
          const suyas = cubiertas
            .filter((c) => c.comprobanteId === f.id)
            .sort((a, b) => (a.recepcionId < b.recepcionId ? -1 : a.recepcionId > b.recepcionId ? 1 : a.linea - b.linea));
          const pesos = suyas.map((c) => importes.get(claveDeLinea(c.recepcionId, c.linea)) ?? null);
          const total = vigente === undefined ? 0n : centavos(vigente.importe);
          const partes =
            pesos.some((p) => p === null) || suyas.length === 0
              ? null
              : repartirConMayorResto(total, pesos.map((p) => centavos(p as string)));
          suyas.forEach((c, i) => {
            abonadoDerivado.set(
              claveDeLinea(c.recepcionId, c.linea),
              partes === null ? null : textoDeImporte(partes[i] as bigint),
            );
          });
        }

        const compras = filas.map((f): CompraParaExportar => {
          const comprobante = f.comprobanteId === null ? null : (facturas.get(f.comprobanteId) ?? null);
          const lineas = (lineasPorRecepcion.get(f.id) ?? [])
            .slice()
            .sort((a, b) => a.numero - b.numero)
            .map((l): LineaParaExportar => {
              const clave = claveDeLinea(f.id, l.numero);
              const producto = productos.get(l.productoId);
              const presentacion = l.presentacionId === null ? undefined : presentaciones.get(l.presentacionId);
              const correccion = ultimas.get(clave);
              const precioPorTipo = correccion?.precioPorTipo ?? l.precioPorTipo;
              const vigenteA = finDelDia(f.fechaNegocio);
              const nodo = clasificaciones
                .filter((c) => c.productoId === l.productoId && c.vigenteDesde.getTime() < vigenteA)
                .sort((a, b) => b.vigenteDesde.getTime() - a.vigenteDesde.getTime())[0]?.nodo;
              const unidadDePrecio = correccion?.precioPorTipo != null ? correccion.unidadDePrecioId : l.unidadDePrecioId;
              const precio = correccion === undefined ? l.precio : correccion.precioNuevo;
              const conPrecio = importes.get(clave) !== null && importes.get(clave) !== undefined;
              return {
                numero: l.numero,
                productoId: l.productoId,
                productoNombre: producto?.nombre ?? "",
                productoCodigo: codigos.get(l.productoId) ?? null,
                clasificacion: nodo ?? null,
                presentacionNombre: presentacion?.nombre ?? null,
                presentacionCantidad: presentacion?.cantidad ?? null,
                cantidadDeCompra: l.cantidadDeCompra,
                unidadDeCompraId: l.unidadDeCompraId,
                unidadDeCompraSimbolo: simbolos.get(l.unidadDeCompraId) ?? l.unidadDeCompraId,
                pesoReal: l.pesoReal,
                cantidadEnStock: l.cantidadEnStock,
                unidadDeStockId: producto?.unidadBaseId ?? "",
                unidadDeStockSimbolo: simbolos.get(producto?.unidadBaseId ?? "") ?? "",
                precio: conPrecio ? precio : null,
                precioPorTipo: conPrecio ? precioPorTipo : null,
                unidadDePrecioSimbolo: conPrecio && unidadDePrecio !== null ? (simbolos.get(unidadDePrecio) ?? null) : null,
                importeVigente: importes.get(clave) ?? null,
                costoPorUnidadDeStock: correccion === undefined ? l.costoPorUnidadDeStock : null,
                importeAbonadoDerivado: abonadoDerivado.get(clave) ?? null,
              };
            });
          return {
            recepcionId: f.id,
            numero: f.numero,
            estado: "CONFIRMADA",
            fechaNegocio: f.fechaNegocio,
            sucursalId: f.sucursalId,
            sucursalNombre: f.sucursalNombre,
            proveedorNombre: razonSocial.get(f.id) ?? nombres.get(f.proveedorId) ?? null,
            registradoEn: f.registradoEn,
            registradoPor: f.registradoPor,
            enCabecera: f.enCabecera,
            enDetalle: f.enDetalle,
            comprobante,
            lineas,
          };
        });

        // 5. La auditoría, en la misma transacción: quién, cuándo (la fila lo sella), qué período y cuántas filas. Nunca los datos.
        await tx.auditoria.registrar({
          empresaId: empresa,
          actorPersonaId: persona,
          accion: "COMPRAS_EXPORTADAS",
          entidad: "exportacion_de_compras",
          entidadId: `${entrada.desde}|${entrada.hasta}`,
          despues: {
            desde: entrada.desde,
            hasta: entrada.hasta,
            filasDeCabecera: compras.filter((c) => c.enCabecera).length,
            filasDeDetalle: compras.filter((c) => c.enDetalle).reduce((n, c) => n + c.lineas.length, 0),
            filasDeResumen: armarResumen(compras).filas.length,
          },
        });
        return ok({ compras, desde: entrada.desde, hasta: entrada.hasta });
      },
    );
  };
}

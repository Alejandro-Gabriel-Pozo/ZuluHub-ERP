import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type {
  DependenciasDeConsultasDeCatalogo,
  TxDeConsultasDeCatalogo,
} from "../casos-de-uso/contrato";
import type { ErrorDeCatalogo } from "../casos-de-uso/errores";
import {
  formaDeFamilia,
  type FormaDeFamilia,
  type MiembroParaForma,
} from "../casos-de-uso/forma-de-la-familia";
import { FORMA_DE_UUID } from "../persistencia/filas";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, ErrorDeCatalogo>;

/** Una familia en la lista de quien la gestiona: con sus interruptores, su versión (la que exigen las acciones) y cuántos productos tiene hoy. */
export type FamiliaParaGestionar = Readonly<{
  id: string;
  nombre: string;
  agruparEnCarta: boolean;
  agruparEnPos: boolean;
  activa: boolean;
  version: number;
  miembros: number;
}>;

export type MiembroDeLaFicha = Readonly<{
  productoId: string;
  nombre: string;
  posicion: number;
  activo: boolean;
  /** Sin medidas: el precio de la empresa (o `null` si no tiene). */
  precio: string | null;
  /** Con medidas: una por medida activa, con su precio de la empresa (o `null`: no se ofrece). */
  medidas: readonly Readonly<{ nombre: string; orden: number; precio: string | null }>[];
}>;

export type FichaDeFamilia = Readonly<{
  familia: FamiliaParaGestionar;
  miembros: readonly MiembroDeLaFicha[];
  /**
   * Cómo saldría en la carta con los precios de la EMPRESA (sin mirar «Ocultar» por sucursal: eso lo resuelve la carta de cada local). La regla es la única de
   * `formaDeFamilia`.
   */
  formaEnLaCarta: FormaDeFamilia;
}>;

/**
 * Las consultas de las familias (A8, CU-F1 a CU-F5), de solo lectura: cada una pide `productos.ver` (los tres roles; quien opera ve las familias y no las
 * cambia). Todo filtra por la empresa del contexto: una familia de otra empresa responde igual que una que no existe.
 */
export function crearConsultasDeFamilias(d: DependenciasDeConsultasDeCatalogo) {
  const leer = <S>(
    contexto: ContextoOperativo,
    accion: "productos.ver",
    trabajo: (tx: TxDeConsultasDeCatalogo) => Promise<R<S>>,
  ): Promise<R<S>> =>
    d.transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<R<S>> => {
        const permiso = await exigirAccion(d.reglas, accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        return trabajo(tx);
      },
    );

  return {
    /** Todas las familias de la empresa (activas o no), por nombre. */
    listarFamilias: (contexto: ContextoOperativo): Promise<R<readonly FamiliaParaGestionar[]>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.listarFamilias.accion, async (tx) =>
        ok(
          (await tx.familias.todas(contexto.empresaId)).map(({ familia, miembros }) => ({
            id: familia.id,
            nombre: familia.nombre,
            agruparEnCarta: familia.agruparEnCarta,
            agruparEnPos: familia.agruparEnPos,
            activa: familia.activa,
            version: familia.version,
            miembros,
          })),
        ),
      ),

    /** La ficha de una familia: sus miembros vigentes con sus medidas y precios de la empresa, y cómo saldría en la carta. */
    verFamilia: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ familiaId: string }>,
    ): Promise<R<FichaDeFamilia>> =>
      leer(contexto, DECLARACIONES_DE_CONSULTAS.verFamilia.accion, async (tx) => {
        if (!FORMA_DE_UUID.test(entrada.familiaId)) return err("FAMILIA_NO_ENCONTRADA");
        const { empresaId } = contexto;
        const familia = await tx.familias.obtener(empresaId, entrada.familiaId);
        if (familia === null) return err("FAMILIA_NO_ENCONTRADA");
        const vigentes = await tx.familias.miembrosVigentes(empresaId, familia.id);
        const miembros: MiembroDeLaFicha[] = [];
        const paraForma: MiembroParaForma[] = [];
        for (const vinculo of vigentes) {
          const producto = await tx.productos.obtener(empresaId, vinculo.productoId);
          if (producto === null) continue;
          const grupos = await tx.opciones.gruposDelProducto(empresaId, producto.id);
          const eje = grupos.find((g) => g.grupo.clase === "VARIANTE" && g.grupo.activo);
          const medidas = [];
          for (const opcion of eje === undefined ? [] : eje.opciones.filter((o) => o.activa)) {
            const fila = await tx.precios.vigente(
              empresaId,
              producto.id,
              opcion.id,
              null,
              contexto.ahora,
            );
            medidas.push({
              nombre: opcion.nombre,
              orden: opcion.orden,
              precio: fila === null ? null : fila.precio,
            });
          }
          const propio =
            eje === undefined
              ? await tx.precios.vigente(empresaId, producto.id, null, null, contexto.ahora)
              : null;
          const precio = propio === null ? null : propio.precio;
          miembros.push({
            productoId: producto.id,
            nombre: producto.nombre,
            posicion: vinculo.posicion,
            activo: producto.activo,
            precio,
            medidas,
          });
          paraForma.push({
            productoId: producto.id,
            seccionId: producto.seccionDeCartaId ?? "",
            activo: producto.activo,
            oculto: false,
            medidas,
            precio,
          });
        }
        return ok({
          familia: {
            id: familia.id,
            nombre: familia.nombre,
            agruparEnCarta: familia.agruparEnCarta,
            agruparEnPos: familia.agruparEnPos,
            activa: familia.activa,
            version: familia.version,
            miembros: vigentes.length,
          },
          miembros,
          formaEnLaCarta: formaDeFamilia({
            familiaActiva: familia.activa,
            agruparEnCarta: familia.agruparEnCarta,
            miembros: paraForma,
          }),
        });
      }),
  };
}

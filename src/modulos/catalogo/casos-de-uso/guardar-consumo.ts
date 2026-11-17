import type { ContextoOperativo } from "../../../contexto/contexto";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { seConsumeLaClase, vendeLaClase } from "../dominio/clases";
import { leerCantidad } from "../dominio/forma-de-venta";
import { esUuid, productoId } from "../dominio/identificadores";
import type { LineaDeConsumo } from "../dominio/modelo";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeGuardarConsumoDeGrupo = Readonly<{
  productoId: string;
  versionDeOpcionesEsperada: number;
  grupoId: string;
  /** El conjunto FINAL de consumo de cada opción nombrada (la pantalla «Qué consume»): las líneas que no figuran se quitan. */
  opciones: ReadonlyArray<{
    opcionId: string;
    lineas: ReadonlyArray<{
      insumoId: string;
      /** Texto decimal exacto, en la unidad base del insumo. */
      cantidad: string;
      /** Se multiplica por el factor del tamaño elegido; solo si el producto tiene variante activa de tamaño. */
      escalaConTamano: boolean;
    }>;
  }>;
}>;

export type SalidaDeGuardarConsumoDeGrupo = Readonly<{
  versionDeOpciones: number;
  yaEstaba: boolean;
}>;

const mismasLineas = (a: readonly LineaDeConsumo[], b: readonly LineaDeConsumo[]): boolean =>
  a.length === b.length &&
  a.every((x) =>
    b.some(
      (y) =>
        y.insumoId === x.insumoId &&
        y.cantidad === x.cantidad &&
        y.escalaConTamano === x.escalaConTamano,
    ),
  );

/**
 * Guardar lo que consume cada opción de un grupo (139; §3.5): SOLO DATO, no descuenta nada. Guard `opciones.editar`, alcance TODAS. Bloquea
 * el producto (existe, activo, se vende). El grupo es del producto, está activo y no es la variante. Cada opción nombrada es del grupo y
 * está activa; cada insumo es un producto activo de la empresa, de clase materia prima, insumo o reventa, distinto del producto, sin repetir;
 * la cantidad es decimal exacto > 0 (4 decimales); `escalaConTamano` solo si el producto tiene variante activa de tamaño. Repetición
 * (`SIN_CAMBIOS`): si todas las opciones ya tienen ese consumo devuelve lo vigente aunque la versión esperada sea vieja, sin insertar
 * versiones. Si no, compara `versionDeOpcionesEsperada` y por cada opción que cambia inserta una versión NUEVA (mismo nombre, recargo y
 * factor) con sus líneas; las demás no se tocan. Lo que una versión ya sellada consumía no cambia nunca.
 */
export function armarGuardarConsumoDeGrupo(dependencias: DependenciasDeCatalogo) {
  return async function guardarConsumoDeGrupo(
    contexto: ContextoOperativo,
    entrada: EntradaDeGuardarConsumoDeGrupo,
  ): Promise<R<SalidaDeGuardarConsumoDeGrupo>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeGuardarConsumoDeGrupo>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["opciones.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const producto = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (!producto.activo) return err("PRODUCTO_INACTIVO");
        if (!vendeLaClase(producto.claseDeUso)) return err("PRODUCTO_NO_VENDIBLE");

        const grupos = await tx.opciones.gruposDelProducto(empresaId, producto.id);
        const delGrupo = grupos.find((g) => g.grupo.id === entrada.grupoId);
        if (delGrupo === undefined || !delGrupo.grupo.activo) return err("GRUPO_NO_ENCONTRADO");
        if (delGrupo.grupo.clase === "VARIANTE") return err("GRUPO_DE_VARIANTE_SIN_CONSUMO");
        const hayTamano = grupos.some(
          ({ grupo }) => grupo.clase === "VARIANTE" && grupo.activo && grupo.esTamano,
        );

        const pedidas = new Set<string>();
        const nuevas: Array<{
          opcion: (typeof delGrupo.opciones)[number];
          lineas: LineaDeConsumo[];
        }> = [];
        for (const p of entrada.opciones) {
          const opcion = delGrupo.opciones.find((o) => o.id === p.opcionId);
          if (opcion === undefined || !opcion.activa || pedidas.has(p.opcionId))
            return err("OPCION_INVALIDA");
          pedidas.add(p.opcionId);
          const insumos = new Set<string>();
          const lineas: LineaDeConsumo[] = [];
          for (const l of p.lineas) {
            if (!esUuid(l.insumoId)) return err("INSUMO_NO_ENCONTRADO");
            if (insumos.has(l.insumoId)) return err("CONSUMO_REPETIDO");
            insumos.add(l.insumoId);
            const cantidad = leerCantidad(l.cantidad);
            if (cantidad === null || cantidad.unidades <= 0n) return err("CANTIDAD_INVALIDA");
            if (l.insumoId === producto.id) return err("INSUMO_ES_EL_MISMO_PRODUCTO");
            const insumo = await tx.productos.obtener(empresaId, l.insumoId);
            if (insumo === null || !insumo.activo) return err("INSUMO_NO_ENCONTRADO");
            if (!seConsumeLaClase(insumo.claseDeUso)) return err("INSUMO_NO_ADMITIDO");
            if (l.escalaConTamano && !hayTamano) return err("ESCALA_SIN_TAMANO");
            lineas.push({
              insumoId: productoId(l.insumoId),
              cantidad: cantidadATexto(cantidad),
              escalaConTamano: l.escalaConTamano,
            });
          }
          nuevas.push({ opcion, lineas });
        }

        const vigentes = await tx.opciones.consumoDeVersiones(
          empresaId,
          nuevas.map((n) => n.opcion.versionId),
        );
        const cambian = nuevas.filter(
          (n) => !mismasLineas(vigentes.get(n.opcion.versionId) ?? [], n.lineas),
        );
        if (cambian.length === 0)
          return ok({ versionDeOpciones: producto.versionDeOpciones, yaEstaba: true });
        if (entrada.versionDeOpcionesEsperada !== producto.versionDeOpciones)
          return err("OPCIONES_DESACTUALIZADAS");

        const versiones: Array<{ opcionId: string; versionId: string; lineas: number }> = [];
        for (const { opcion, lineas } of cambian) {
          const versionId = await tx.opciones.insertarVersion(empresaId, {
            opcionId: opcion.id,
            numero: opcion.numero + 1,
            nombre: opcion.nombre,
            recargo: opcion.recargo,
            factorDeTamano: opcion.factorDeTamano,
            cargadaPor: contexto.personaId,
            creadaEn: contexto.ahora,
          });
          await tx.opciones.insertarConsumo(empresaId, versionId, lineas);
          versiones.push({ opcionId: opcion.id, versionId, lineas: lineas.length });
        }
        const subido = await tx.productos.subirVersionDeOpciones(empresaId, producto.id);
        if (subido === null) return err("PRODUCTO_NO_ENCONTRADO");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "CONSUMO_DE_OPCIONES_GUARDADO",
          entidad: "producto",
          entidadId: producto.id,
          antes: { versionDeOpciones: producto.versionDeOpciones },
          despues: {
            versionDeOpciones: subido.versionDeOpciones,
            grupoId: entrada.grupoId,
            versionesNuevas: versiones,
          },
        });
        return ok({ versionDeOpciones: subido.versionDeOpciones, yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

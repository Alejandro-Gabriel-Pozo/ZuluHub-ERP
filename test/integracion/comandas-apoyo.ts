import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeComandas,
  crearConsultasDeComandas,
  crearRepositoriosDeComandas,
  type TxDeComandas,
  type TxDeConsultasDeComandas,
} from "../../src/modulos/comandas/publico";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { Transacciones } from "../../src/puertos/transacciones";
import type { BaseDePruebas } from "./global";
import type { TxDePrueba } from "./entorno";
import {
  REGLAS_DE_PRUEBA,
  montarVentas,
  nuevoId,
  valorDe,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Apoyo de las pruebas de integración de comandas (E7 T5 y T7): el mundo de ventas (base propia, rol real de la aplicación, módulos de ventas activos para
 * la empresa) con los repositorios de comandas sumados a la MISMA conexión de cada transacción (como la `TxDeApp` real) y el módulo `comandas` activo y
 * disponible para la empresa (el real está en desarrollo: se inyectan `reglas` y la autorización suma el módulo; el ROL y el ALCANCE salen de la base).
 */
export const REGLAS_CON_COMANDAS: ReglasDeEmpresa = {
  catalogo: {
    ...REGLAS_DE_PRUEBA.catalogo,
    comandas: { ...CATALOGO_DE_MODULOS.comandas, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

/** Las reglas reales del catálogo: `comandas` está en desarrollo y nadie puede nada (denegar por defecto). */
export const REGLAS_REALES: ReglasDeEmpresa = {
  catalogo: CATALOGO_DE_MODULOS,
  permisos: PERMISOS_DE_EMPRESA,
};

export async function montarComandas(base: BaseDePruebas, conexiones = 14) {
  const m = await montarVentas(base, {
    conexiones,
    ajustarTx: (tx: TxDePrueba): TxDePrueba => {
      const conComandas = { ...tx, ...crearRepositoriosDeComandas(tx.db) };
      return {
        ...conComandas,
        autorizacion: {
          ...tx.autorizacion,
          delActor: async (contexto: ContextoOperativo) => {
            const datos = await tx.autorizacion.delActor(contexto);
            return datos.rol === null
              ? datos
              : {
                  ...datos,
                  modulosActivados: [...datos.modulosActivados, "comandas"],
                  modulosHabilitados: [...datos.modulosHabilitados, "comandas"],
                };
          },
        },
      };
    },
  });
  const transacciones = m.entorno as unknown as Transacciones<TxDeComandas>;
  const casos = crearCasosDeUsoDeComandas({ transacciones, reglas: REGLAS_CON_COMANDAS });
  const casosReales = crearCasosDeUsoDeComandas({ transacciones, reglas: REGLAS_REALES });
  const consultas = crearConsultasDeComandas({
    transacciones: m.entorno as unknown as Transacciones<TxDeConsultasDeComandas>,
    reglas: REGLAS_CON_COMANDAS,
  });

  /** Una cuenta abierta con `n` líneas del producto del escenario (cada una de la cantidad dada). */
  const cuentaConLineas = async (
    e: Awaited<ReturnType<MundoDeVentas["escenario"]>>,
    n: number,
    cantidad = "1",
  ) => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    const lineas: string[] = [];
    for (let i = 0; i < n; i++) {
      const linea = nuevoId();
      valorDe(
        await m.casos.agregarLinea(e.gerente, {
          cuentaId: cuenta,
          lineaId: linea,
          productoId: e.producto,
          opcionIds: [],
          cantidad,
        }),
      );
      lineas.push(linea);
    }
    return { cuenta, lineas };
  };

  return {
    ...m,
    casosDeComandas: casos,
    casosReales,
    consultasDeComandas: consultas,
    cuentaConLineas,
  };
}

export type MundoDeComandas = Awaited<ReturnType<typeof montarComandas>>;

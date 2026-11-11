import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import type { ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { Transacciones } from "../../src/puertos/transacciones";
import {
  crearCasosDeUsoDeSalon,
  crearConsultasDeSalon,
  crearRepositoriosDeSalon,
  type TxDeConsultasDeSalon,
  type TxDeSalon,
} from "../../src/modulos/salon/publico";
import type { TxDePrueba } from "./entorno";
import type { BaseDePruebas } from "./global";
import { montarVentas, REGLAS_DE_PRUEBA } from "./ventas-apoyo";

/**
 * Apoyo de las pruebas de integración del salón (E7): el mundo de ventas (base propia, caja, cierre, catálogo) con los módulos `salon` y `comandas`
 * ACTIVOS para la empresa (los módulos reales están en desarrollo: se inyectan `reglas` con ambos disponibles; el ROL y el ALCANCE salen de la base,
 * como siempre) y los repositorios del salón sobre la MISMA conexión de la transacción. Lo que se prueba pasa por el rol real.
 */
export const REGLAS_DE_SALON: ReglasDeEmpresa = {
  ...REGLAS_DE_PRUEBA,
  catalogo: {
    ...REGLAS_DE_PRUEBA.catalogo,
    comandas: { ...CATALOGO_DE_MODULOS.comandas, estado: "disponible" },
    salon: { ...CATALOGO_DE_MODULOS.salon, estado: "disponible" },
  },
};

/** Suma a la transacción de prueba los repositorios del salón y deja activos `salon` y `comandas` para el actor (lo demás lo deja `montarVentas`). */
export function conSalon(tx: TxDePrueba): TxDePrueba {
  const salon = crearRepositoriosDeSalon(tx.db);
  return {
    ...tx,
    ...salon,
    autorizacion: {
      ...tx.autorizacion,
      delActor: async (contexto) => {
        const datos = await tx.autorizacion.delActor(contexto);
        return datos.rol === null
          ? datos
          : {
              ...datos,
              modulosActivados: [...datos.modulosActivados, "salon", "comandas"],
              modulosHabilitados: [...datos.modulosHabilitados, "salon", "comandas"],
            };
      },
    },
  };
}

export async function montarSalon(
  base: BaseDePruebas,
  opciones: Readonly<{ conexiones?: number; stock?: boolean }> = {},
) {
  const m = await montarVentas(base, { ...opciones, ajustarTx: conSalon });
  const transacciones = m.entorno as unknown as Transacciones<TxDeSalon>;
  const lecturas = m.entorno as unknown as Transacciones<TxDeConsultasDeSalon>;
  return {
    ...m,
    reglas: REGLAS_DE_SALON,
    salon: crearCasosDeUsoDeSalon({ transacciones, reglas: REGLAS_DE_SALON }),
    consultasDeSalon: crearConsultasDeSalon({ transacciones: lecturas, reglas: REGLAS_DE_SALON }),
  };
}

export type MundoDeSalon = Awaited<ReturnType<typeof montarSalon>>;

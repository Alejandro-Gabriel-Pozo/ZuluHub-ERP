import { crearCasosDeUsoDeComandas, crearConsultasDeComandas } from "../modulos/comandas/publico";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeComandas({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Comandas (E7): enviar a cocina, pedir que salga, anular un ítem enviado, quitar sin enviar, las impresoras y los trabajos de impresión, cada uno con
     * SU acción. El módulo está `disponible` desde S-0r (17/11/2026, DEC-0714): cada empresa lo activa por su plan. El papel se
     * imprime en el navegador con el diálogo del sistema: el servidor solo entrega el modelo (`documentoParaImprimir`).
     */
    casosDeUsoDeComandas: perezoso(() =>
      crearCasosDeUsoDeComandas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeComandas: perezoso(() =>
      crearConsultasDeComandas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}

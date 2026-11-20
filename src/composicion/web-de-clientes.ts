import { crearCasosDeUsoDeClientes, crearConsultasDeClientes } from "../modulos/clientes/publico";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeClientes({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Clientes y proveedores (E9): el directorio de partes con sus roles y vínculos (casos de uso) y sus consultas, cada uno con SU acción de `partes`. El
     * módulo es de la empresa, no de una sucursal. Los puertos que ofrece a compras (`crearDirectorioDePartes`, `crearRegistroDePartes`) no salen por acá:
     * corren en la transacción de quien los llama.
     */
    casosDeUsoDeClientes: perezoso(() =>
      crearCasosDeUsoDeClientes({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeClientes: perezoso(() =>
      crearConsultasDeClientes({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}

import { describe, expect, expectTypeOf, it } from "vitest";
import type { NivelesDeControl } from "../../src/capacidades/controles/niveles";
import type { TxDeApp } from "../../src/composicion/conexiones";
import type { TxDeConsultasDeEmpresas, TxDeEmpresas } from "../../src/modulos/empresas/publico";
import type { TxDeConsultasDeIdentidad, TxDeIdentidad } from "../../src/modulos/identidad/publico";
import type { Transacciones } from "../../src/puertos/transacciones";

/**
 * La `Tx` COMPUESTA (conciliación §3.3): la composición arma UNA `Tx` con los repositorios de varios
 * módulos sobre la misma transacción de la base, y cada módulo declara solo la `Tx` angosta que usa.
 * Lo que se promete y esta prueba comprueba al compilar (`npm run typecheck` incluye `test/`):
 *
 *  - la compuesta CONTIENE cada `Tx` angosta: se le puede pasar tal cual a un caso de uso, consulta o
 *    puerto `*EnTx` de cualquier módulo, y las `Transacciones<TxDeApp>` sirven donde un módulo pide
 *    `Transacciones<SuTx>` (si un módulo declara algo que la composición no arma, no compila);
 *  - la angosta NO alcanza donde se pide la compuesta: un módulo no puede colar una `Tx` suya donde
 *    otro necesita más.
 *
 * Nada de esto se ejecuta: son tipos. Que la compuesta sea de verdad UNA transacción lo prueba
 * `test/integracion/tx-compuesta.test.ts`.
 */

describe("la Tx compuesta de la composición contiene la Tx angosta de cada módulo", () => {
  it("empresas, identidad y controles", () => {
    expectTypeOf<TxDeApp>().toExtend<TxDeEmpresas>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeEmpresas>();
    expectTypeOf<TxDeApp>().toExtend<TxDeIdentidad>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeIdentidad>();
    expectTypeOf<TxDeApp>().toExtend<Readonly<{ niveles: NivelesDeControl }>>();
  });

  it("las Transacciones de la composición sirven donde un módulo pide las suyas", () => {
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeEmpresas>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeIdentidad>>();
  });

  it("la Tx angosta de un módulo no alcanza donde hace falta la compuesta (no compila)", () => {
    const pideLaCompuesta = (tx: TxDeApp): TxDeApp => tx;
    const noSeEjecuta = (angosta: TxDeEmpresas) => {
      // @ts-expect-error TxDeEmpresas no trae los repositorios de identidad ni los niveles de control
      pideLaCompuesta(angosta);
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});

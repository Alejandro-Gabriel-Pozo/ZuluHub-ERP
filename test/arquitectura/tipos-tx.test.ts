import { describe, expect, expectTypeOf, it } from "vitest";
import type { NivelesDeControl } from "../../src/capacidades/controles/niveles";
import type { TxDeApp } from "../../src/composicion/conexiones";
import type { TxDeCredenciales } from "../../src/adaptadores/certificados/credenciales-de-emisor";
import type { TxDeTickets } from "../../src/adaptadores/certificados/almacen-de-tickets";
import type { TxDeVerificacion } from "../../src/adaptadores/certificados/verificacion-de-autorizacion";
import type { TxDeCatalogo, TxDeConsultasDeCatalogo } from "../../src/modulos/catalogo/publico";
import type {
  TxDeCierre,
  TxDeConsultasDeCierre,
  TxDeJornadas,
} from "../../src/modulos/cierre/publico";
import type {
  TxDeAporteDeVentas,
  TxDeConsultasDeVentas,
  TxDeVentas,
} from "../../src/modulos/ventas/publico";
import type { TxDeConsultasDeEmpresas, TxDeEmpresas } from "../../src/modulos/empresas/publico";
import type {
  TxDeCertificados,
  TxDeConfiguracionFiscal,
  TxDeConsultasDeFacturacion,
  TxDeFacturacion,
} from "../../src/modulos/fiscal/publico";
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
    expectTypeOf<TxDeApp>().toExtend<TxDeCatalogo>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeCatalogo>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeEmpresas>();
    expectTypeOf<TxDeApp>().toExtend<TxDeIdentidad>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeIdentidad>();
    expectTypeOf<TxDeApp>().toExtend<Readonly<{ niveles: NivelesDeControl }>>();
  });

  it("cierre del día: casos de uso, consultas y el puerto de la jornada que usan los otros módulos", () => {
    expectTypeOf<TxDeApp>().toExtend<TxDeCierre>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeCierre>();
    expectTypeOf<TxDeApp>().toExtend<TxDeJornadas>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeCierre>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeConsultasDeCierre>>();
  });

  it("ventas: casos de uso, consultas y lo que lee el aporte al cierre del día", () => {
    expectTypeOf<TxDeApp>().toExtend<TxDeVentas>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeVentas>();
    expectTypeOf<TxDeApp>().toExtend<TxDeAporteDeVentas>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeVentas>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeConsultasDeVentas>>();
  });

  it("fiscal: facturación, consultas, configuración, certificados y lo que descifra el adaptador de ARCA", () => {
    expectTypeOf<TxDeApp>().toExtend<TxDeFacturacion>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConsultasDeFacturacion>();
    expectTypeOf<TxDeApp>().toExtend<TxDeConfiguracionFiscal>();
    expectTypeOf<TxDeApp>().toExtend<TxDeCertificados>();
    expectTypeOf<TxDeApp>().toExtend<TxDeCredenciales>();
    expectTypeOf<TxDeApp>().toExtend<TxDeTickets>();
    expectTypeOf<TxDeApp>().toExtend<TxDeVerificacion>();
  });

  it("las Transacciones de la composición sirven donde un módulo pide las suyas", () => {
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeEmpresas>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeCatalogo>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeConsultasDeCatalogo>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeIdentidad>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeFacturacion>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeConsultasDeFacturacion>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeConfiguracionFiscal>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeCertificados>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeCredenciales>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeTickets>>();
    expectTypeOf<Transacciones<TxDeApp>>().toExtend<Transacciones<TxDeVerificacion>>();
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

import { randomUUID } from "node:crypto";
import { crearCasosDeUsoDeCaja } from "../../../src/modulos/caja/publico";
import { crearCasosDeUsoDeVentas } from "../../../src/modulos/ventas/publico";
import { fechaDeNegocio } from "../../../src/primitivas/tiempo/fecha-de-negocio";
import { empresaId, personaId, sucursalId } from "../../../src/primitivas/identificadores/marca";
import { productoDeBase, precioDeBase } from "../../integracion/catalogo-apoyo";
import { conteoDe } from "../../integracion/caja-cierre-del-dia-apoyo";
import { comoEmpresa, crearEntornoDePrueba } from "../../integracion/entorno";
import { ahoraDeLaCorrida } from "../../integracion/reloj-de-la-corrida";
import { valorDe, REGLAS_DE_PRUEBA } from "../../integracion/ventas-apoyo";
import type { MundoDelRecorrido } from "./mundo";

/**
 * Siembra, en el mundo del recorrido, UN DÍA de caja listo para cerrar, por el camino real (los casos de uso de caja y de ventas, con la base y el rol reales): una caja abierta, UNA venta cobrada
 * con dos medios (efectivo y tarjeta de crédito por una terminal) y la caja cerrada con su conteo y el total de la terminal. Queda la jornada abierta y sin cajas por cerrar: lo que «Cierre del día» recibe para empezar el cierre.
 * Los módulos `catalogo`, `caja`, `cierre` y `ventas` tienen que estar activos en la empresa (`armarMundoDelRecorrido` con `modulosAdicionales`). Con `REGLAS_DE_PRUEBA` los módulos «en desarrollo» se
 * abren en ESTE proceso; la app real los abre con `activar-modulos-en-desarrollo.mjs`.
 */

export type JornadaSembrada = Readonly<{
  /** `AAAA-MM-DD`. */
  fechaDeNegocio: string;
  sucursal: string;
  /** El correo de quien hizo todo: así se muestra «quién». */
  correo: string;
  ticketId: string;
  medios: Readonly<{ efectivo: string; debito: string; credito: string }>;
  cuentas: Readonly<{ terminal: string }>;
}>;

export async function sembrarJornadaParaElCierre(
  mundo: MundoDelRecorrido,
): Promise<JornadaSembrada> {
  const dueno = mundo.mundo.dueno;
  const empresa = mundo.empresa;
  const consulta = async <T extends object>(texto: string, parametros: unknown[]): Promise<T> =>
    (await dueno.query<T>(texto, parametros)).rows[0] as T;

  const { id: sucursal } = await consulta<{ id: string }>(
    "select id from sucursal where empresa_id = $1 limit 1",
    [empresa],
  );
  const { persona_id: persona, email: correo } = await consulta<{
    persona_id: string;
    email: string;
  }>(
    "select m.persona_id, p.email from membresia m join persona p on p.id = m.persona_id where m.empresa_id = $1 limit 1",
    [empresa],
  );

  const entorno = crearEntornoDePrueba(mundo.mundo.propia.base, 4);
  try {
    const contexto = {
      ...comoEmpresa(empresaId(empresa), personaId(persona), mundo.mundo.marcaA),
      ahora: ahoraDeLaCorrida(),
    };
    const caja = crearCasosDeUsoDeCaja({ transacciones: entorno, reglas: REGLAS_DE_PRUEBA });
    const ventas = crearCasosDeUsoDeVentas({ transacciones: entorno, reglas: REGLAS_DE_PRUEBA });

    const producto = await productoDeBase(dueno, empresa, { nombre: "Combo del mostrador" });
    await precioDeBase(dueno, {
      empresa,
      producto,
      precio: "1000.00",
      desde: "2026-01-01T00:00:00Z",
    });
    const { id: cajaId } = await consulta<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja del recorrido') returning id",
      [empresa, sucursal],
    );
    await dueno.query(
      "insert into medio_de_pago (empresa_id, tipo) values ($1, 'EFECTIVO') on conflict do nothing",
      [empresa],
    );
    const { id: efectivo } = await consulta<{ id: string }>(
      "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO' and nombre is null",
      [empresa],
    );
    const debito = valorDe(
      await caja.crearMedioDePago(contexto, { tipo: "TARJETA_DEBITO", nombre: null }),
    ).medioDePagoId;
    const credito = valorDe(
      await caja.crearMedioDePago(contexto, { tipo: "TARJETA_CREDITO", nombre: null }),
    ).medioDePagoId;
    const terminal = valorDe(
      await caja.crearCuentaDeCobro(contexto, {
        tipo: "TERMINAL",
        nombre: "Posnet 1",
        identificadorExterno: null,
        sucursalId: sucursal,
      }),
    ).cuentaDeCobroId;

    const sesion = valorDe(
      await caja.abrirSesion(contexto, {
        claveDeIdempotencia: `clave-${randomUUID()}`,
        sucursalId: sucursalId(sucursal),
        cajaId,
        fondoInicial: { moneda: "ARS", monto: "0.00" },
      }),
    );
    const cobrado = valorDe(
      await ventas.venderYCobrar(contexto, {
        claveIdempotencia: `clave-${randomUUID()}`,
        cuentaId: randomUUID(),
        ejemplarId: randomUUID(),
        sucursalId: sucursal,
        lineas: [{ lineaId: randomUUID(), productoId: producto, opcionIds: [], cantidad: "1" }],
        totalEsperado: { moneda: "ARS", monto: "1000.00" },
        cobro: {
          cajaId,
          cobros: [
            {
              medioDePagoId: efectivo,
              cuentaDeCobroId: null,
              importe: { moneda: "ARS", monto: "400.00" },
            },
            {
              medioDePagoId: credito,
              cuentaDeCobroId: terminal,
              importe: { moneda: "ARS", monto: "600.00" },
            },
          ],
        },
      }),
    );
    // La caja se cierra: el efectivo contado es lo esperado (400) y el total de la terminal es el registrado (600).
    valorDe(
      await caja.cerrarSesion(contexto, {
        sesionId: sesion.sesionId,
        conteo: conteoDe("400.00"),
        otros: [
          {
            medioDePagoId: credito,
            cuentaDeCobroId: terminal,
            contado: { moneda: "ARS", monto: "600.00" },
          },
        ],
        conformeGeneral: false,
        observacion: null,
      }),
    );
    const fecha = fechaDeNegocio(contexto.ahora, "America/Argentina/Buenos_Aires", "00:00");
    if (!fecha.ok) throw new Error("no se pudo calcular la fecha de negocio de la siembra");
    return {
      fechaDeNegocio: fecha.valor,
      sucursal,
      correo,
      ticketId: cobrado.ticketId,
      medios: { efectivo, debito, credito },
      cuentas: { terminal },
    };
  } finally {
    await entorno.cerrar();
  }
}

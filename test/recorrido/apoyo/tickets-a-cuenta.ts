import { randomUUID } from "node:crypto";
import { crearCuentaCorrienteDeVentas } from "../../../src/composicion/cuenta-corriente-de-ventas";
import { armarTxDeSaldos } from "../../../src/composicion/libro-de-saldos";
import { crearCasosDeUsoDeCaja } from "../../../src/modulos/caja/publico";
import { crearRepositoriosDeCuentaCorriente } from "../../../src/modulos/cuenta_corriente/publico";
import { crearCasosDeUsoDeVentas } from "../../../src/modulos/ventas/publico";
import { empresaId, personaId, sucursalId } from "../../../src/primitivas/identificadores/marca";
import { precioDeBase, productoDeBase } from "../../integracion/catalogo-apoyo";
import { HUELLA, claveNueva } from "../../integracion/caja-apoyo";
import { comoEmpresa, crearEntornoDePrueba, type TxDePrueba } from "../../integracion/entorno";
import { ahoraDeLaCorrida } from "../../integracion/reloj-de-la-corrida";
import { cuitUnico } from "../../integracion/unicos";
import { REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE, valorDe } from "../../integracion/ventas-apoyo";
import type { MundoDelRecorrido } from "./mundo";

/**
 * Siembra, en el mundo del recorrido, lo que «Cobrar un ticket a cuenta» necesita, por el camino real (casos de uso de caja y de ventas, con la base y los roles reales): un cliente con cuenta
 * corriente, UNA caja abierta hoy con efectivo y `cantidad` tickets de `precio` cargados a ese cliente (cada uno deja su cargo en el libro). Los módulos tienen que estar activos en la empresa
 * (`armarMundoDelRecorrido` con `modulosAdicionales`). Con `REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE` los módulos «en desarrollo» se abren en ESTE proceso; la app real los abre con
 * `activar-modulos-en-desarrollo.mjs`.
 */
export type TicketsACuentaSembrados = Readonly<{
  clienteId: string;
  clienteNombre: string;
  sucursal: string;
  tickets: readonly Readonly<{ ticketId: string; numero: string }>[];
}>;

export async function sembrarTicketsACuenta(
  mundo: MundoDelRecorrido,
  opciones: Readonly<{ precio: string; cantidad: number }>,
): Promise<TicketsACuentaSembrados> {
  const dueno = mundo.mundo.dueno;
  const empresa = mundo.empresa;
  const consulta = async <T extends object>(texto: string, parametros: unknown[]): Promise<T> =>
    (await dueno.query<T>(texto, parametros)).rows[0] as T;

  const { id: sucursal } = await consulta<{ id: string }>(
    "select id from sucursal where empresa_id = $1 limit 1",
    [empresa],
  );
  const { persona_id: persona } = await consulta<{ persona_id: string }>(
    "select persona_id from membresia where empresa_id = $1 limit 1",
    [empresa],
  );

  const clienteNombre = "Agencia del recorrido";
  const { id: clienteId } = await consulta<{ id: string }>(
    `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
     values (gen_random_uuid(), $1, gen_random_uuid(), 'JURIDICA', $2, 'CUIT', $3, $4) returning id`,
    [empresa, clienteNombre, cuitUnico(), persona],
  );
  await dueno.query(
    "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
    [empresa, clienteId],
  );
  await dueno.query(
    `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
     values ($1, $2, 30, '100000.00', $3, $4, $5)`,
    [empresa, clienteId, claveNueva(), HUELLA, persona],
  );

  const entorno = crearEntornoDePrueba(mundo.mundo.propia.base, 4, (tx: TxDePrueba) => {
    const { asientos, imputaciones, saldos } = armarTxDeSaldos(tx.db);
    return {
      ...tx,
      ...crearRepositoriosDeCuentaCorriente(tx.db),
      asientos,
      imputaciones,
      saldos,
    } as TxDePrueba;
  });
  try {
    const contexto = {
      ...comoEmpresa(empresaId(empresa), personaId(persona), mundo.mundo.marcaA),
      ahora: ahoraDeLaCorrida(),
    };
    const reglas = REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE;
    const caja = crearCasosDeUsoDeCaja({ transacciones: entorno, reglas });
    const ventas = crearCasosDeUsoDeVentas({
      transacciones: entorno,
      reglas,
      cuentaCorriente: crearCuentaCorrienteDeVentas(reglas),
    });

    const producto = await productoDeBase(dueno, empresa, { nombre: "Servicio a cuenta" });
    await precioDeBase(dueno, {
      empresa,
      producto,
      precio: opciones.precio,
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
    valorDe(
      await caja.abrirSesion(contexto, {
        claveDeIdempotencia: `clave-${randomUUID()}`,
        sucursalId: sucursalId(sucursal),
        cajaId,
        fondoInicial: { moneda: "ARS", monto: "0.00" },
      }),
    );

    const tickets: { ticketId: string; numero: string }[] = [];
    for (let i = 0; i < opciones.cantidad; i += 1) {
      const cuentaId = randomUUID();
      valorDe(await ventas.abrirCuenta(contexto, { cuentaId, sucursalId: sucursal }));
      valorDe(
        await ventas.agregarLinea(contexto, {
          cuentaId,
          lineaId: randomUUID(),
          productoId: producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      const cerrada = valorDe(
        await ventas.cerrarCuenta(contexto, {
          cuentaId,
          ejemplarId: randomUUID(),
          clienteId,
          totalEsperado: { moneda: "ARS", monto: opciones.precio },
        }),
      );
      const { numero } = await consulta<{ numero: string }>(
        "select numero::text as numero from ticket where id = $1",
        [cerrada.ticketId],
      );
      tickets.push({ ticketId: cerrada.ticketId, numero });
      // Dos cargos con el mismo instante de registro empatarían el «más antiguo»: un respiro los separa.
      await new Promise((r) => setTimeout(r, 20));
    }
    return { clienteId, clienteNombre, sucursal, tickets };
  } finally {
    await entorno.cerrar();
  }
}

import { randomUUID } from "node:crypto";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import type { EscenarioDeVentas, MundoDeVentas } from "./ventas-apoyo";

/**
 * Lo que las pruebas de la venta a cuenta corriente arman por fuera de los casos de uso (como dueño de la base, que evade RLS): un cliente con su ficha de cuenta corriente y las lecturas del libro
 * (asientos y saldo). Lo que se prueba pasa siempre por el rol real; esto solo prepara y mira.
 */
export function ayudantesDeCuentaCorriente(m: MundoDeVentas) {
  /** Un cliente con su ficha (límite y plazo a elección); el producto de las pruebas vale $1000. */
  const cliente = async (
    de: EscenarioDeVentas,
    o: Partial<{ limite: string; plazo: number; suspendida: boolean; sinFicha: boolean }> = {},
  ): Promise<string> => {
    const id = randomUUID();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, de.empresa, `Cliente ${sufijoUnico()}`, cuitUnico(), de.gerente.personaId],
    );
    await m.dueno.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [de.empresa, id],
    );
    if (o.sinFicha !== true) {
      await m.dueno.query(
        `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          de.empresa,
          id,
          o.plazo ?? 30,
          o.limite ?? "100000.00",
          claveNueva(),
          HUELLA,
          de.gerente.personaId,
        ],
      );
      if (o.suspendida === true) {
        await m.dueno.query(
          "update cuenta_del_cliente set estado = 'SUSPENDIDA', motivo_de_suspension = 'Prueba' where parte_id = $1",
          [id],
        );
      }
    }
    return id;
  };

  /** Los asientos del libro de un cliente, del más viejo al más nuevo. */
  const asientos = (de: EscenarioDeVentas, clienteId: string) =>
    m.filas<{ id: string; importe: string; clase: string; sentido: string; origen_id: string }>(
      `select id, importe::text, clase, sentido, origen_id from asiento_de_saldo
        where empresa_id = $1 and parte_id = $2 order by registrado_en, id`,
      [de.empresa, clienteId],
    );

  /** Lo que el cliente nos debe (A_COBRAR), como texto decimal; `0` si no hay nada. */
  const saldo = async (de: EscenarioDeVentas, clienteId: string): Promise<string> =>
    (
      await m.filas<{ s: string }>(
        "select coalesce(sum(saldo), 0)::text as s from saldo_de_parte where empresa_id = $1 and parte_id = $2 and sentido = 'A_COBRAR'",
        [de.empresa, clienteId],
      )
    )[0]?.s ?? "0";

  return { cliente, asientos, saldo };
}

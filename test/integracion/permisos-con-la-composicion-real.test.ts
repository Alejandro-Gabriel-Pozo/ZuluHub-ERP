import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { armarConexiones } from "../../src/composicion/conexiones";
import { ok } from "../../src/primitivas/resultado/resultado";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase } from "./fixtures-identidad";
import { crearMundoDeMarca } from "./marcas-apoyo";

/**
 * Con la composición REAL (`armarConexiones().transaccionesDeApp()`, la que usa la web): los permisos se memorizan SOLO en lectura. En
 * una transacción que escribe, un cambio propio se ve en la lectura siguiente; en las de lectura, las listas de módulos que se reparten
 * entre los consumidores del pedido están congeladas. Previene: que `memorizar` quede en `true` (o se cablee distinto) y una operación
 * que cambia un permiso decida con el viejo. Las pruebas de `lecturas-compartidas` usan el cableado del entorno de prueba y no lo ven.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("permisos con la composición real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: ReturnType<typeof armarConexiones>;
  let contexto: ContextoOperativo;
  let empresa: string;
  let persona: string;
  let marca: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const m = await crearMundoDeMarca(dueno);
    empresa = m.empresa;
    marca = m.marca;
    const p = await crearPersonaDeBase(dueno);
    persona = p.id;
    await crearMembresiaDeBase(dueno, empresa, persona, "OPERADOR");
    conexiones = armarConexiones({
      fuente: () => ({
        PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
        PEDERNAL_DB_APP: propia.base.app,
      }),
    });
    contexto = {
      ...comoEmpresa(empresaId(empresa), personaId(persona)),
      marcaDeEntrada: marca as ContextoOperativo["marcaDeEntrada"],
    };
  });
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await dueno.end();
    await propia.destruir();
  });

  it("en una transacción que ESCRIBE, la lectura siguiente del mismo pedido ve el cambio de permiso hecho en ella (no se memoriza)", async () => {
    const r = await conexiones.transaccionesDeApp().ejecutar({ contexto }, async (tx) => {
      const antes = await tx.autorizacion.delActor(contexto);
      const membresia = await tx.membresias.obtener(empresaId(empresa), personaId(persona));
      if (membresia === null) throw new Error("falta la membresía");
      const apagada = await tx.membresias.apagar(
        empresaId(empresa),
        personaId(persona),
        membresia.version,
      );
      const despues = await tx.autorizacion.delActor(contexto);
      return ok({ antes: antes.rol, apagada, despues: despues.rol });
    });
    expect(r).toEqual({ ok: true, valor: { antes: "OPERADOR", apagada: true, despues: null } });
    // Y la baja quedó confirmada: el pedido siguiente tampoco tiene rol.
    const siguiente = await conexiones
      .transaccionesDeApp()
      .ejecutar({ contexto, aislamiento: "read committed", soloLectura: true }, async (tx) =>
        ok((await tx.autorizacion.delActor(contexto)).rol),
      );
    expect(siguiente).toEqual({ ok: true, valor: null });
    await dueno.query("update membresia set activo = true where empresa_id = $1", [empresa]);
  });

  it("en lectura sí se memoriza (una sola lectura del rol por transacción), con la misma composición", async () => {
    const r = await conexiones
      .transaccionesDeApp()
      .ejecutar({ contexto, aislamiento: "read committed", soloLectura: true }, async (tx) => {
        const uno = await tx.autorizacion.delActor(contexto);
        await dueno.query("update membresia set activo = false where empresa_id = $1", [empresa]);
        const dos = await tx.autorizacion.delActor(contexto);
        return ok({ uno: uno.rol, dos: dos.rol });
      });
    await dueno.query("update membresia set activo = true where empresa_id = $1", [empresa]);
    // El cambio hecho por OTRO mientras la transacción de lectura sigue abierta no se ve: el pedido decidió con una sola lectura.
    expect(r).toEqual({ ok: true, valor: { uno: "OPERADOR", dos: "OPERADOR" } });
  });

  it("las listas de módulos que se reparten entre los consumidores del pedido están congeladas: ninguno puede cambiarle algo a otro", async () => {
    const r = await conexiones
      .transaccionesDeApp()
      .ejecutar({ contexto, aislamiento: "read committed", soloLectura: true }, async (tx) => {
        const actor = await tx.autorizacion.delActor(contexto);
        const otra = await tx.autorizacion.delActor(contexto);
        return ok({
          activados: Object.isFrozen(actor.modulosActivados),
          habilitados: Object.isFrozen(actor.modulosHabilitados),
          mismas: actor.modulosActivados === otra.modulosActivados,
        });
      });
    expect(r).toEqual({ ok: true, valor: { activados: true, habilitados: true, mismas: true } });
  });
});

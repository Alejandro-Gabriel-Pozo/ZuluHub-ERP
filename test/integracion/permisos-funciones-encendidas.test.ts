import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearConsultasDeEmpresas } from "../../src/modulos/empresas/publico";
import { empresaId, marcaComercialId, personaId } from "../../src/primitivas/identificadores/marca";
import { contarSentencias, type ContadorDeSentencias } from "./contar-sentencias";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { crearMembresiaDeBase } from "./fixtures-identidad";
import { ajustarPerilla, asignarPlan, crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";

/**
 * X-1b: `permisosDelActor` devuelve las funciones de pago encendidas, leídas en la MISMA transacción del pedido (una sola apertura), solo si
 * la empresa tiene algún módulo con funciones, cada empresa con la suya (aislamiento) y con la vigencia del plan al `ahora` del contexto.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("permisosDelActor: funciones encendidas (Postgres real)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let consultas: ReturnType<typeof crearConsultasDeEmpresas>;
  let contador: ContadorDeSentencias;

  type Mundo = Readonly<{ empresa: string; tenant: string; persona: string; marca: string }>;
  let soloFactura: Mundo;
  let conSalonEncendido: Mundo;
  let conSalonApagado: Mundo;
  let apagaMañana: Mundo;

  async function mundo(modulos: readonly string[], activados: readonly string[]): Promise<Mundo> {
    const m = await crearMundoDeMarca(dueno);
    const { version } = await crearPlanPublicado(dueno, { modulos: [...modulos] });
    await asignarPlan(dueno, m.tenant, version);
    for (const modulo of activados) {
      await dueno.query("insert into modulo_de_empresa (empresa_id, modulo) values ($1, $2)", [
        m.empresa,
        modulo,
      ]);
    }
    await crearMembresiaDeBase(dueno, m.empresa, m.persona, "GERENTE");
    return { empresa: m.empresa, tenant: m.tenant, persona: m.persona, marca: m.marca };
  }

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    consultas = crearConsultasDeEmpresas({
      transacciones: crearEntornoDePrueba(propia.base, 3),
      reglas: REGLAS_DE_EMPRESA,
    });
    contador = contarSentencias(dueno);
    soloFactura = await mundo(["facturacion"], ["facturacion"]);
    conSalonEncendido = await mundo(["salon"], ["salon"]);
    await ajustarPerilla(dueno, conSalonEncendido.tenant, "salon", "1");
    conSalonApagado = await mundo(["salon"], ["salon"]);
    apagaMañana = await mundo(["salon"], ["salon"]);
    await ajustarPerilla(dueno, apagaMañana.tenant, "salon", "1");
    await ajustarPerilla(dueno, apagaMañana.tenant, "salon", "0", { desdeSegundos: 86_400 });
  });

  afterAll(async () => {
    contador.detener();
    await dueno.end();
    await propia.destruir();
  });

  const contextoDe = (m: Mundo, ahora = new Date()): ContextoOperativo => ({
    tipo: "OPERATIVO",
    empresaId: empresaId(m.empresa),
    personaId: personaId(m.persona),
    marcaDeEntrada: marcaComercialId(m.marca),
    ahora,
  });
  const funcionesDe = async (m: Mundo, ahora?: Date) => {
    const r = await consultas.permisosDelActor(contextoDe(m, ahora));
    if (!r.ok) throw new Error(`permisosDelActor rechazó: ${JSON.stringify(r.error)}`);
    return r.valor.funcionesEncendidas;
  };
  const sentencias = async (m: Mundo) => {
    contador.reiniciar();
    await funcionesDe(m);
    return contador.sentencias();
  };
  const aperturas = (s: readonly string[]) =>
    s.filter((x) => /^(begin|start transaction)/i.test(x)).length;

  it("una empresa que solo factura no lee los derechos: [] sin sentencias de más", async () => {
    expect(await funcionesDe(soloFactura)).toEqual([]);
  });

  it("el pedido sigue siendo UNA transacción y la lectura suma sentencias que se informan", async () => {
    const sin = await sentencias(soloFactura);
    const con = await sentencias(conSalonEncendido);
    expect(aperturas(sin)).toBe(1);
    expect(aperturas(con)).toBe(1);
    expect(con.length).toBeGreaterThan(sin.length);
    console.info(
      `[X-1b] permisosDelActor: ${String(sin.length)} sentencias sin funciones, ${String(con.length)} con salón (+${String(con.length - sin.length)})`,
    );
  });

  it("aislamiento: cada empresa recibe la suya", async () => {
    expect(await funcionesDe(conSalonEncendido)).toEqual(["salon"]);
    expect(await funcionesDe(conSalonApagado)).toEqual([]);
    expect(await funcionesDe(soloFactura)).toEqual([]);
  });

  it("vigencia: hoy sigue encendida; con el `ahora` de pasado mañana, apagada", async () => {
    expect(await funcionesDe(apagaMañana)).toEqual(["salon"]);
    const pasadoMañana = new Date(Date.now() + 2 * 86_400_000);
    expect(await funcionesDe(apagaMañana, pasadoMañana)).toEqual([]);
  });

  it("dos pedidos a la vez dan lo mismo (solo lectura, sin estado compartido)", async () => {
    const resultados = await Promise.all([
      funcionesDe(conSalonEncendido),
      funcionesDe(conSalonEncendido),
      funcionesDe(conSalonApagado),
    ]);
    expect(resultados).toEqual([["salon"], ["salon"], []]);
  });
});

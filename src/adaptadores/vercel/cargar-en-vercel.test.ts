import { describe, expect, it } from "vitest";
import { cargarEnVercel } from "./cargar-en-vercel";
import type { ClienteDeVariables, FallaDeVercel, RespuestaDeVercel } from "./cliente-vercel";
import type { Paso, VariableRemota } from "./plan-de-variables";

function remota(key: string, parcial: Partial<VariableRemota> = {}): VariableRemota {
  return {
    id: `id_${key}`,
    key,
    type: "sensitive",
    target: ["preview"],
    gitBranch: null,
    customEnvironmentIds: [],
    ...parcial,
  };
}

const ok = { ok: true, valor: null } as const;
const fallo = (motivo: string, incierta = false): RespuestaDeVercel<never> => ({
  ok: false,
  error: { motivo, incierta } satisfies FallaDeVercel,
});

type Fallas = Partial<
  Record<"escribir" | "borrar" | "quitar" | "listar", RespuestaDeVercel<never>>
>;

/** Un cliente falso que anota cada llamada y devuelve `estado` al listar. */
function clienteFalso(estado: readonly VariableRemota[], fallas: Fallas = {}) {
  const llamadas: string[] = [];
  const cliente: ClienteDeVariables = {
    listar: () => {
      llamadas.push("listar");
      return Promise.resolve(fallas.listar ?? { ok: true, valor: estado });
    },
    escribir: (clave, valor, destino) => {
      llamadas.push(`escribir ${clave}=${valor} en ${destino}`);
      return Promise.resolve(fallas.escribir ?? ok);
    },
    borrar: (id) => {
      llamadas.push(`borrar ${id}`);
      return Promise.resolve(fallas.borrar ?? ok);
    },
    quitarDestinos: (id, quedan) => {
      llamadas.push(`quitar ${id} deja ${quedan.join("+")}`);
      return Promise.resolve(fallas.quitar ?? ok);
    },
  };
  return { cliente, llamadas };
}

const PASOS: readonly Paso[] = [
  { tipo: "escribir", key: "A", value: "va" },
  { tipo: "escribir", key: "B", value: "vb" },
  { tipo: "borrar", id: "id_X", key: "DATABASE_URL" },
  { tipo: "recortar", id: "id_Y", key: "POSTGRES_URL", target: ["production"] },
];

describe("cargarEnVercel", () => {
  it("ejecuta los pasos en orden con el destino pedido y, al terminar, verifica leyendo el proyecto", async () => {
    const { cliente, llamadas } = clienteFalso([remota("A"), remota("B")]);
    const r = await cargarEnVercel(cliente, "preview", PASOS);
    expect(llamadas).toEqual([
      "escribir A=va en preview",
      "escribir B=vb en preview",
      "borrar id_X",
      "quitar id_Y deja production",
      "listar",
    ]);
    expect(r).toEqual({
      escritas: ["A", "B"],
      noEscritas: [],
      borradas: ["DATABASE_URL"],
      recortadas: ["POSTGRES_URL"],
      falla: null,
      problemas: [],
      sinVerificar: false,
    });
  });

  it("escribe en production cuando el destino es production", async () => {
    const { cliente, llamadas } = clienteFalso([remota("A", { target: ["production"] })]);
    await cargarEnVercel(cliente, "production", [{ tipo: "escribir", key: "A", value: "x" }]);
    expect(llamadas[0]).toBe("escribir A=x en production");
  });

  it("se frena en la primera falla: lo que sigue no se intenta, no se verifica y se cuenta como no escrito", async () => {
    const { cliente, llamadas } = clienteFalso([], {
      escribir: fallo("Vercel respondió 500: falla del lado de Vercel", true),
    });
    const r = await cargarEnVercel(cliente, "preview", PASOS);
    expect(llamadas).toEqual(["escribir A=va en preview"]);
    expect(r).toEqual({
      escritas: [],
      noEscritas: ["A", "B"],
      borradas: [],
      recortadas: [],
      falla: {
        paso: "escribir A",
        motivo: "Vercel respondió 500: falla del lado de Vercel",
        incierta: true,
      },
      problemas: [],
      sinVerificar: false,
    });
  });

  it("si falla la segunda escritura, la primera queda confirmada", async () => {
    let n = 0;
    const base = clienteFalso([]);
    const cliente: ClienteDeVariables = {
      ...base.cliente,
      escribir: (clave) => {
        n += 1;
        base.llamadas.push(`escribir ${clave}`);
        return Promise.resolve(n === 2 ? fallo("no") : ok);
      },
    };
    const r = await cargarEnVercel(cliente, "preview", PASOS);
    expect(r.escritas).toEqual(["A"]);
    expect(r.noEscritas).toEqual(["B"]);
    expect(r.falla).toEqual({ paso: "escribir B", motivo: "no", incierta: false });
    expect(base.llamadas).toEqual(["escribir A", "escribir B"]);
  });

  it("nombra el paso que falló: borrar y quitar el destino", async () => {
    const borrando = await cargarEnVercel(
      clienteFalso([], { borrar: fallo("x") }).cliente,
      "preview",
      PASOS,
    );
    expect(borrando.falla?.paso).toBe("borrar DATABASE_URL");
    expect(borrando.escritas).toEqual(["A", "B"]);
    expect(borrando.noEscritas).toEqual([]);
    const recortando = await cargarEnVercel(
      clienteFalso([], { quitar: fallo("x") }).cliente,
      "preview",
      PASOS,
    );
    expect(recortando.falla?.paso).toBe("quitar el destino de POSTGRES_URL");
    expect(recortando.borradas).toEqual(["DATABASE_URL"]);
  });

  it("verificación: una variable que falta, una no sensible y una compartida quedan como no escritas, con su problema", async () => {
    const { cliente } = clienteFalso([
      remota("B", { type: "plain" }),
      remota("C", { target: ["preview", "production"] }),
      remota("A", { target: ["production"] }),
    ]);
    const r = await cargarEnVercel(cliente, "preview", [
      { tipo: "escribir", key: "A", value: "1" },
      { tipo: "escribir", key: "B", value: "2" },
      { tipo: "escribir", key: "C", value: "3" },
    ]);
    expect(r.problemas).toEqual([
      { nombre: "A", texto: "no figura en preview" },
      { nombre: "B", texto: "no quedó como sensible y solo para preview" },
      { nombre: "C", texto: "no quedó como sensible y solo para preview" },
    ]);
    expect(r.noEscritas).toEqual(["A", "B", "C"]);
    expect(r.escritas).toEqual(["A", "B", "C"]);
  });

  it("verificación: basta que UNA de las entradas del destino esté mal (un duplicado no sensible)", async () => {
    const { cliente } = clienteFalso([remota("A"), remota("A", { type: "plain" })]);
    const r = await cargarEnVercel(cliente, "preview", [
      { tipo: "escribir", key: "A", value: "1" },
    ]);
    expect(r.problemas).toEqual([
      { nombre: "A", texto: "no quedó como sensible y solo para preview" },
    ]);
    expect(r.noEscritas).toEqual(["A"]);
  });

  it("verificación: lo prohibido que sigue en el destino es un problema; en otro destino, no", async () => {
    const { cliente } = clienteFalso([
      remota("A"),
      remota("DATABASE_URL", { target: ["preview", "production"] }),
      remota("POSTGRES_URL", { target: ["production"] }),
      remota("PEDERNAL_DB_MIGRACIONES", { target: ["preview"] }),
      remota("OTRA", { type: "plain", target: ["preview"] }),
    ]);
    const r = await cargarEnVercel(cliente, "preview", [
      { tipo: "escribir", key: "A", value: "1" },
    ]);
    expect(r.problemas).toEqual([
      { nombre: "DATABASE_URL", texto: "sigue en preview" },
      { nombre: "PEDERNAL_DB_MIGRACIONES", texto: "sigue en preview" },
    ]);
    expect(r.noEscritas).toEqual([]);
  });

  it("si no se puede releer el proyecto lo dice (sin verificar) y no inventa problemas", async () => {
    const { cliente } = clienteFalso([], { listar: fallo("caído", true) });
    const r = await cargarEnVercel(cliente, "preview", [
      { tipo: "escribir", key: "A", value: "1" },
    ]);
    expect(r.sinVerificar).toBe(true);
    expect(r.problemas).toEqual([]);
    expect(r.escritas).toEqual(["A"]);
    expect(r.noEscritas).toEqual([]);
    expect(r.falla).toBeNull();
  });

  it("sin pasos no toca Vercel ni lo relee", async () => {
    const { cliente, llamadas } = clienteFalso([]);
    expect(await cargarEnVercel(cliente, "production", [])).toEqual({
      escritas: [],
      noEscritas: [],
      borradas: [],
      recortadas: [],
      falla: null,
      problemas: [],
      sinVerificar: false,
    });
    expect(llamadas).toEqual([]);
  });
});

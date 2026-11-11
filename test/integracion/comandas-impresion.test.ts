import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import { montarComandas, type MundoDeComandas } from "./comandas-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * E7-T7, impresoras y trabajos de impresión con los casos de uso reales y el rol de la aplicación: guardar dos veces es una sola impresora, un documento
 * original tiene un solo trabajo por más toques que haya (P11), «Reintentar» es el mismo trabajo con un intento más, la copia es otro trabajo con la hora
 * del envío original, el resultado lo declara el dispositivo (idempotente), y aislamiento, alcance y permisos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

type Cualquiera = Resultado<unknown, unknown>;
const codigo = (r: Cualquiera): string => {
  if (r.ok) return "ok";
  const x = r.error;
  if (typeof x === "string") return x;
  if (typeof x === "object" && x !== null) {
    if ("error" in x && typeof x.error === "string") return x.error;
    if ("codigo" in x && typeof x.codigo === "string") return x.codigo;
    if ("tipo" in x && typeof x.tipo === "string") return x.tipo;
  }
  return "otro";
};

describe.skipIf(base === null)("comandas: impresoras e impresión", () => {
  let m: MundoDeComandas;
  let e: EscenarioDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarComandas(base);
    e = await m.escenario();
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const impresora = (
    cambios: Partial<Parameters<MundoDeComandas["casosDeComandas"]["registrarImpresora"]>[1]> = {},
    contexto: ContextoOperativo = e.gerente,
  ) =>
    m.casosDeComandas.registrarImpresora(contexto, {
      impresoraId: nuevoId(),
      sucursalId: e.sucursal,
      nombre: `Cocina ${nuevoId().slice(0, 6)}`,
      uso: "COMANDA",
      papelMm: 80,
      ...cambios,
    });

  /** Un envío ya hecho, con su comanda para imprimir. */
  const unEnvio = async (x: EscenarioDeVentas = e) => {
    const { cuenta } = await m.cuentaConLineas(x, 2);
    const envio = valorDe(
      await m.casosDeComandas.enviarACocina(x.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        rotulo: "Mesa 5",
        claveIdempotencia: nuevaClave(),
      }),
    );
    return { cuenta, envio };
  };
  const solicitar = (
    documentoId: string,
    cambios: Partial<Parameters<MundoDeComandas["casosDeComandas"]["solicitarImpresion"]>[1]> = {},
    contexto: ContextoOperativo = e.gerente,
  ) =>
    m.casosDeComandas.solicitarImpresion(contexto, {
      trabajoId: nuevoId(),
      documentoTipo: "COMANDA",
      documentoId,
      claveIdempotencia: nuevaClave(),
      ...cambios,
    });

  it("guardar dos veces la misma impresora es una sola; el nombre es único por sucursal", async () => {
    const entrada = {
      impresoraId: nuevoId(),
      sucursalId: e.sucursal,
      nombre: "Barra",
      uso: "TICKET",
      papelMm: 58,
    };
    const a = valorDe(await m.casosDeComandas.registrarImpresora(e.gerente, entrada));
    expect(a).toMatchObject({ yaExistia: false, version: 1 });
    const b = valorDe(await m.casosDeComandas.registrarImpresora(e.gerente, entrada));
    expect(b).toMatchObject({ impresoraId: entrada.impresoraId, yaExistia: true });
    expect(
      await m.contar(
        "select count(*) as n from impresora where sucursal_id = $1 and nombre = 'Barra'",
        [e.sucursal],
      ),
    ).toBe(1);
    // El mismo id con otra cosa no se pisa; el mismo nombre con otro id, tampoco.
    expect(
      codigo(await m.casosDeComandas.registrarImpresora(e.gerente, { ...entrada, papelMm: 80 })),
    ).toBe("IMPRESORA_ID_EN_USO");
    expect(codigo(await impresora({ nombre: "Barra" }))).toBe("NOMBRE_DE_IMPRESORA_EN_USO");
    // Dos altas del mismo nombre a la vez: queda una.
    const [x, y] = await Promise.all([
      impresora({ nombre: "Plancha" }),
      impresora({ nombre: "Plancha" }),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    // Lista de permitidos: uso, papel y nombre.
    expect(codigo(await impresora({ uso: "OTRO" }))).toBe("USO_INVALIDO");
    expect(codigo(await impresora({ papelMm: 70 }))).toBe("PAPEL_INVALIDO");
    expect(codigo(await impresora({ nombre: "<b>" }))).toBe("NOMBRE_DE_IMPRESORA_INVALIDO");
    // El operador mira las impresoras pero no arma el plano de impresión; otra sucursal fuera de su alcance.
    expect(codigo(await impresora({}, e.operador))).toBe("SIN_PERMISO");
    const lista = valorDe(
      await m.consultasDeComandas.impresorasDeLaSucursal(e.operador, { sucursalId: e.sucursal }),
    );
    expect(lista.map((i) => i.nombre)).toContain("Barra");
    expect(
      codigo(
        await m.consultasDeComandas.impresorasDeLaSucursal(e.operador, {
          sucursalId: e.otraSucursal,
        }),
      ),
    ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    expect(await m.auditoria(e.empresa, "IMPRESORA_CREADA")).not.toHaveLength(0);
  });

  it("editar una impresora con lo mismo no cambia nada; con una versión vieja, VERSION_DESACTUALIZADA", async () => {
    const creada = valorDe(await impresora({ nombre: "Salon" }));
    const sin = valorDe(
      await m.casosDeComandas.editarImpresora(e.gerente, {
        impresoraId: creada.impresoraId,
        nombre: "Salon",
        papelMm: 80,
      }),
    );
    expect(sin).toMatchObject({ yaExistia: true, version: 1 });
    const cambio = valorDe(
      await m.casosDeComandas.editarImpresora(e.gerente, {
        impresoraId: creada.impresoraId,
        papelMm: 58,
        versionEsperada: 1,
      }),
    );
    expect(cambio).toMatchObject({ yaExistia: false, version: 2 });
    expect(
      codigo(
        await m.casosDeComandas.editarImpresora(e.gerente, {
          impresoraId: creada.impresoraId,
          papelMm: 80,
          versionEsperada: 1,
        }),
      ),
    ).toBe("VERSION_DESACTUALIZADA");
    expect(
      codigo(
        await m.casosDeComandas.editarImpresora(e.gerente, {
          impresoraId: creada.impresoraId,
          nombre: "Barra",
        }),
      ),
    ).toBe("NOMBRE_DE_IMPRESORA_EN_USO");
    expect(
      codigo(
        await m.casosDeComandas.editarImpresora(e.gerente, { impresoraId: nuevoId(), papelMm: 58 }),
      ),
    ).toBe("IMPRESORA_NO_ENCONTRADA");
    // Otra empresa ve la impresora como inexistente.
    const otra = await m.escenario();
    expect(
      codigo(
        await m.casosDeComandas.editarImpresora(otra.gerente, {
          impresoraId: creada.impresoraId,
          papelMm: 58,
        }),
      ),
    ).toBe("IMPRESORA_NO_ENCONTRADA");
  });

  it("desactivar una impresora dos veces es lo mismo y no se borra", async () => {
    const creada = valorDe(await impresora({ nombre: "Vieja" }));
    const a = valorDe(
      await m.casosDeComandas.desactivarImpresora(e.gerente, { impresoraId: creada.impresoraId }),
    );
    expect(a.yaEstabaDesactivada).toBe(false);
    const b = valorDe(
      await m.casosDeComandas.desactivarImpresora(e.gerente, { impresoraId: creada.impresoraId }),
    );
    expect(b.yaEstabaDesactivada).toBe(true);
    expect(
      await m.contar("select count(*) as n from impresora where id = $1 and not activa", [
        creada.impresoraId,
      ]),
    ).toBe(1);
    const activas = valorDe(
      await m.consultasDeComandas.impresorasDeLaSucursal(e.gerente, { sucursalId: e.sucursal }),
    );
    expect(activas.map((i) => i.id)).not.toContain(creada.impresoraId);
    const todas = valorDe(
      await m.consultasDeComandas.impresorasDeLaSucursal(e.gerente, {
        sucursalId: e.sucursal,
        incluirInactivas: true,
      }),
    );
    expect(todas.map((i) => i.id)).toContain(creada.impresoraId);
    expect(
      codigo(
        await m.casosDeComandas.desactivarImpresora(e.operador, {
          impresoraId: creada.impresoraId,
        }),
      ),
    ).toBe("SIN_PERMISO");
  });

  it("P11: imprimir dos veces seguidas es UN trabajo; reintentar es el mismo trabajo con un intento más", async () => {
    const { envio } = await unEnvio();
    // El envío ya dejó su trabajo original (sin impresora: «Ver en pantalla»): imprimir dos veces es ese mismo trabajo.
    const a = valorDe(await solicitar(envio.envioId));
    expect(a).toMatchObject({
      trabajoId: envio.trabajoId,
      estado: "PENDIENTE",
      intentos: 1,
      yaExistia: true,
    });
    const b = valorDe(await solicitar(envio.envioId));
    expect(b.trabajoId).toBe(a.trabajoId);
    expect(
      await m.contar(
        "select count(*) as n from trabajo_de_impresion where documento_id = $1 and not es_copia",
        [envio.envioId],
      ),
    ).toBe(1);
    // Ahora sí con impresora: el trabajo de un envío NUEVO sale con la impresora de cocina.
    const cocina = valorDe(await impresora({ nombre: "Cocina P11" }));
    const nuevo = await unEnvio();
    const t = valorDe(await solicitar(nuevo.envio.envioId));
    expect(t).toMatchObject({ trabajoId: nuevo.envio.trabajoId, yaExistia: true });
    expect(cocina.impresoraId).toBeDefined();
    // El dispositivo declara que falló: «Reintentar» es el mismo trabajo con un intento más (también con doble toque).
    valorDe(
      await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
        trabajoId: t.trabajoId,
        numero: 1,
        resultado: "FALLIDA",
      }),
    );
    const [r1, r2] = await Promise.all([
      solicitar(nuevo.envio.envioId),
      solicitar(nuevo.envio.envioId),
    ]);
    const reintentos = [valorDe(r1), valorDe(r2)];
    expect(new Set(reintentos.map((r) => r.trabajoId))).toEqual(new Set([t.trabajoId]));
    expect(reintentos.filter((r) => r.reintento)).toHaveLength(1);
    const fila = await m.filas<{ estado: string; intentos: number }>(
      "select estado, intentos from trabajo_de_impresion where id = $1",
      [t.trabajoId],
    );
    expect(fila[0]).toEqual({ estado: "PENDIENTE", intentos: 2 });
    const impresa = valorDe(
      await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
        trabajoId: t.trabajoId,
        numero: 2,
        resultado: "IMPRESA",
      }),
    );
    expect(impresa).toMatchObject({ estado: "IMPRESA", intentos: 2 });
    // Una impresa no se reintenta sola: el toque devuelve el mismo trabajo sin intento nuevo.
    const otra = valorDe(await solicitar(nuevo.envio.envioId));
    expect(otra).toMatchObject({ estado: "IMPRESA", intentos: 2, reintento: false });
    // Documentos que no existen o de otra empresa: inexistentes; tipo inválido.
    expect(codigo(await solicitar(nuevoId()))).toBe("DOCUMENTO_NO_ENCONTRADO");
    const ajena = await m.escenario();
    expect(codigo(await solicitar(nuevo.envio.envioId, {}, ajena.gerente))).toBe(
      "DOCUMENTO_NO_ENCONTRADO",
    );
    expect(codigo(await solicitar(nuevo.envio.envioId, { documentoTipo: "FACTURA" }))).toBe(
      "DOCUMENTO_INVALIDO",
    );
    // Concurrencia: muchos toques a la vez sobre un documento sin trabajo previo (un ticket sin envío no existe: se usa un aviso nuevo) dejan uno solo.
    const x = await unEnvio();
    const toques = await Promise.all(
      Array.from({ length: 6 }, () =>
        repetirSiAgotada(() => solicitar(x.envio.envioId), { esAgotada: agotadaEnElResultado }),
      ),
    );
    expect(new Set(toques.map((r) => valorDe(r).trabajoId)).size).toBe(1);
    expect(
      await m.contar(
        "select count(*) as n from trabajo_de_impresion where documento_id = $1 and not es_copia",
        [x.envio.envioId],
      ),
    ).toBe(1);
  });

  it("una copia es un trabajo nuevo con su clave: repetir la misma clave devuelve el mismo trabajo y no toca la cuenta", async () => {
    const { cuenta, envio } = await unEnvio();
    const antes = await m.filas(
      "select (select ultimo from contador_de_envios where cuenta_id = $1) as u, (select total_provisorio from cuenta_consumo where id = $1) as t, (select count(*) from envio_de_comanda where cuenta_id = $1) as n",
      [cuenta],
    );
    const entrada = {
      trabajoId: nuevoId(),
      documentoTipo: "COMANDA",
      documentoId: envio.envioId,
      claveIdempotencia: nuevaClave(),
    };
    const a = valorDe(await m.casosDeComandas.solicitarCopia(e.gerente, entrada));
    expect(a).toMatchObject({ yaExistia: false, estado: "PENDIENTE" });
    expect(a.trabajoId).not.toBe(envio.trabajoId);
    const b = valorDe(await m.casosDeComandas.solicitarCopia(e.gerente, entrada));
    expect(b).toMatchObject({ trabajoId: a.trabajoId, yaExistia: true });
    expect(
      codigo(
        await m.casosDeComandas.solicitarCopia(e.gerente, {
          ...entrada,
          trabajoId: nuevoId(),
          documentoId: nuevoId(),
        }),
      ),
    ).toBe("DOCUMENTO_NO_ENCONTRADO");
    // Otra copia (otra clave) es otro trabajo: cada copia deja constancia de quién y cuándo.
    const c = valorDe(
      await m.casosDeComandas.solicitarCopia(e.gerente, {
        ...entrada,
        trabajoId: nuevoId(),
        claveIdempotencia: nuevaClave(),
      }),
    );
    expect(c.trabajoId).not.toBe(a.trabajoId);
    expect(
      await m.contar(
        "select count(*) as n from trabajo_de_impresion where documento_id = $1 and es_copia",
        [envio.envioId],
      ),
    ).toBe(2);
    const auditoria = (await m.auditoria(e.empresa, "COPIA_SOLICITADA")).filter((x) =>
      [a.trabajoId, c.trabajoId].includes(x["entidad_id"] as string),
    );
    expect(auditoria).toHaveLength(2);
    // La cuenta, el envío y el contador siguen como estaban.
    const despues = await m.filas(
      "select (select ultimo from contador_de_envios where cuenta_id = $1) as u, (select total_provisorio from cuenta_consumo where id = $1) as t, (select count(*) from envio_de_comanda where cuenta_id = $1) as n",
      [cuenta],
    );
    expect(despues).toEqual(antes);
    // Misma clave con otra intención: reutilización.
    expect(
      codigo(await solicitar(envio.envioId, { claveIdempotencia: entrada.claveIdempotencia })),
    ).toBe("CLAVE_REUTILIZADA");
    // El papel de la copia: «Copia», con el envío original, sin precios.
    const papel = valorDe(
      await m.consultasDeComandas.documentoParaImprimir(e.gerente, {
        documentoTipo: "COMANDA",
        documentoId: envio.envioId,
        copia: true,
      }),
    );
    const texto = papel.lineas.map((l) => l.texto).join("\n");
    expect(texto).toContain("Copia");
    expect(texto).toContain("Envío 1");
    expect(texto).not.toMatch(/\$|1000/);
    const original = valorDe(
      await m.consultasDeComandas.documentoParaImprimir(e.gerente, {
        documentoTipo: "COMANDA",
        documentoId: envio.envioId,
      }),
    );
    expect(original.lineas.map((l) => l.texto).join("\n")).not.toContain("Copia");
  });

  it("declarar dos veces el mismo resultado de un intento es lo mismo; otro distinto, RESULTADO_YA_DECLARADO", async () => {
    const { envio } = await unEnvio();
    const t = envio.trabajoId;
    const a = valorDe(
      await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
        trabajoId: t,
        numero: 1,
        resultado: "IMPRESA",
      }),
    );
    expect(a).toMatchObject({ estado: "IMPRESA", yaExistia: false });
    const b = valorDe(
      await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
        trabajoId: t,
        numero: 1,
        resultado: "IMPRESA",
      }),
    );
    expect(b).toMatchObject({ estado: "IMPRESA", yaExistia: true });
    expect(
      codigo(
        await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
          trabajoId: t,
          numero: 1,
          resultado: "FALLIDA",
        }),
      ),
    ).toBe("RESULTADO_YA_DECLARADO");
    expect(
      codigo(
        await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
          trabajoId: t,
          numero: 2,
          resultado: "IMPRESA",
        }),
      ),
    ).toBe("INTENTO_NO_PEDIDO");
    expect(
      codigo(
        await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
          trabajoId: t,
          numero: 1,
          resultado: "QUIZAS",
        }),
      ),
    ).toBe("RESULTADO_INVALIDO");
    expect(
      codigo(
        await m.casosDeComandas.declararResultadoDeImpresion(e.gerente, {
          trabajoId: nuevoId(),
          numero: 1,
          resultado: "IMPRESA",
        }),
      ),
    ).toBe("TRABAJO_NO_ENCONTRADO");
    expect(
      await m.contar("select count(*) as n from intento_de_impresion where trabajo_id = $1", [t]),
    ).toBe(1);
    // El intento no se edita ni se borra, ni por el dueño de la base.
    await expect(
      m.dueno.query("update intento_de_impresion set resultado = 'FALLIDA' where trabajo_id = $1", [
        t,
      ]),
    ).rejects.toThrow();
  });

  it("el aviso de anulación se imprime desde su foto: cantidad, lo que queda y el motivo, sin precios, y la reimpresión sale igual aunque el catálogo cambie", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1, "3");
    valorDe(
      await m.casosDeComandas.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        rotulo: "Mesa 9",
        claveIdempotencia: nuevaClave(),
      }),
    );
    const avisoId = nuevoId();
    valorDe(
      await m.casosDeComandas.anularItemEnviado(e.gerente, {
        cuentaId: cuenta,
        lineaId: lineas[0] as string,
        cantidad: "1",
        motivo: "Error del mozo",
        avisoId,
        rotulo: "Mesa 9",
      }),
    );
    const pedir = () =>
      m.consultasDeComandas.documentoParaImprimir(e.gerente, {
        documentoTipo: "ANULACION",
        documentoId: avisoId,
      });
    const antes = valorDe(await pedir());
    const texto = antes.lineas.map((l) => l.texto).join("\n");
    expect(texto).toContain("ANULACIÓN · NO PREPARAR");
    expect(texto).toContain("Mesa 9");
    expect(texto).toContain("Error del mozo");
    expect(texto).toMatch(/Quedan: 2/);
    await m.dueno
      .query("update producto set nombre = 'Otro nombre' where id = $1", [e.producto])
      .catch(() => undefined);
    expect(valorDe(await pedir())).toEqual(antes);
    expect(
      codigo(
        await m.consultasDeComandas.documentoParaImprimir(e.gerente, {
          documentoTipo: "ANULACION",
          documentoId: nuevoId(),
        }),
      ),
    ).toBe("DOCUMENTO_NO_ENCONTRADO");
    // Otra empresa no ve el documento.
    const ajena = await m.escenario();
    expect(
      codigo(
        await m.consultasDeComandas.documentoParaImprimir(ajena.gerente, {
          documentoTipo: "ANULACION",
          documentoId: avisoId,
        }),
      ),
    ).toBe("DOCUMENTO_NO_ENCONTRADO");
    const fichas = valorDe(
      await m.consultasDeComandas.trabajosDeImpresion(e.gerente, { documentoId: avisoId }),
    );
    expect(fichas).toHaveLength(1);
  });
});

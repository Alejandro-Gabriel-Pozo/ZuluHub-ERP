import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import { montarComandas, type MundoDeComandas } from "./comandas-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * E7-T5, comandas con los casos de uso reales y una base real con el rol de la aplicación: el envío numerado sin huecos aunque varios envíen a la vez
 * (P1), el doble toque (P2), enviar contra agregar y quitar (P3), pedir que salga, quitar sin enviar, cambiar la salida, anular un ítem ya enviado con el
 * precio congelado (P12), la fecha de negocio del envío (P17), y aislamiento, alcance y autorización (P13). Las rondas de concurrencia son pocas por
 * defecto (`PEDERNAL_RONDAS`, 3) para no gastar el presupuesto del CI; al cerrar el tramo se corre con 50.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 900_000 });

const RONDAS = (() => {
  const n = Number(process.env["PEDERNAL_RONDAS"] ?? 3);
  return Number.isInteger(n) && n >= 1 ? n : 3;
})();

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

describe.skipIf(base === null)("comandas: envíos, anulaciones y salida", () => {
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

  const enviar = (
    cuenta: string,
    cambios: Partial<Parameters<MundoDeComandas["casosDeComandas"]["enviarACocina"]>[1]> = {},
    contexto: ContextoOperativo = e.gerente,
  ) =>
    m.casosDeComandas.enviarACocina(contexto, {
      envioId: nuevoId(),
      cuentaId: cuenta,
      rotulo: "Mesa 5",
      claveIdempotencia: nuevaClave(),
      ...cambios,
    });

  const numerosDeEnvio = async (cuenta: string) =>
    (
      await m.filas<{ numero: number }>(
        "select numero from envio_de_comanda where cuenta_id = $1 order by numero",
        [cuenta],
      )
    ).map((f) => f.numero);

  it("P2: el doble toque en «Enviar a cocina» (mismo envío y misma clave) es un solo envío y un solo papel; otro toque sin nada pendiente, NADA_PARA_ENVIAR", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 2);
    const envioId = nuevoId();
    const clave = nuevaClave();
    const a = valorDe(await enviar(cuenta, { envioId, claveIdempotencia: clave }));
    expect(a).toMatchObject({ numero: 1, lineas: 2, yaExistia: false, sinImpresora: true });
    const b = valorDe(await enviar(cuenta, { envioId, claveIdempotencia: clave }));
    expect(b).toMatchObject({ envioId, numero: 1, yaExistia: true, trabajoId: a.trabajoId });
    expect(
      await m.contar("select count(*) as n from envio_de_comanda where cuenta_id = $1", [cuenta]),
    ).toBe(1);
    expect(
      await m.contar(
        "select count(*) as n from trabajo_de_impresion where documento_id = $1 and not es_copia",
        [envioId],
      ),
    ).toBe(1);
    // Otra clave y otro id, sin nada pendiente: no se arma un envío vacío.
    expect(codigo(await enviar(cuenta))).toBe("NADA_PARA_ENVIAR");
    // La misma clave con OTRA cosa es una reutilización.
    const otra = await m.cuentaConLineas(e, 1);
    expect(codigo(await enviar(otra.cuenta, { claveIdempotencia: clave }))).toBe(
      "CLAVE_REUTILIZADA",
    );
    expect(await numerosDeEnvio(cuenta)).toEqual([1]);
    const enviadas = await m.filas<{ envio_id: string | null }>(
      "select envio_id from linea_de_comanda where cuenta_id = $1",
      [cuenta],
    );
    expect(enviadas.map((f) => f.envio_id)).toEqual([envioId, envioId]);
    expect(lineas).toHaveLength(2);
    // Auditoría con quién, cuándo y qué.
    const auditoria = await m.auditoria(e.empresa, "ENVIO_REGISTRADO");
    expect(auditoria.filter((x) => x["entidad_id"] === envioId)).toHaveLength(1);
  });

  it("P1: varios mozos envían a la vez en la misma mesa con líneas que se cargan en el medio: números 1..N sin huecos y cada línea en un solo envío", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { cuenta } = await m.cuentaConLineas(e, 1);
      const resultados = await Promise.all(
        Array.from({ length: 8 }, async (_, i) => {
          const lineaId = nuevoId();
          const agregada = await repetirSiAgotada(
            () =>
              m.casos.agregarLinea(e.gerente, {
                cuentaId: cuenta,
                lineaId,
                productoId: e.producto,
                opcionIds: [],
                cantidad: "1",
              }),
            { esAgotada: agotadaEnElResultado },
          );
          const contexto = i % 2 === 0 ? e.gerente : e.administrador;
          const pedido = { envioId: nuevoId(), claveIdempotencia: nuevaClave() };
          const envio = await repetirSiAgotada(() => enviar(cuenta, pedido, contexto), {
            esAgotada: agotadaEnElResultado,
          });
          return { agregada, envio };
        }),
      );
      for (const r of resultados) {
        expect(["ok", "NADA_PARA_ENVIAR"], JSON.stringify(r.envio)).toContain(codigo(r.envio));
        expect(r.agregada.ok).toBe(true);
      }
      // Lo que no salió todavía sale con un envío más; después, nada queda sin enviar.
      const ultimo = await enviar(cuenta);
      expect(["ok", "NADA_PARA_ENVIAR"]).toContain(codigo(ultimo));
      const numeros = await numerosDeEnvio(cuenta);
      expect(numeros).toEqual(Array.from({ length: numeros.length }, (_, i) => i + 1));
      expect(numeros.length).toBeGreaterThanOrEqual(1);
      const sinEnviar = await m.contar(
        "select count(*) as n from linea_de_comanda where cuenta_id = $1 and envio_id is null",
        [cuenta],
      );
      expect(sinEnviar).toBe(0);
      // Cada línea sale en UN solo envío: un renglón SALE por línea.
      const repetidas = await m.contar(
        `select count(*) as n from (select linea_id from renglon_de_envio r join envio_de_comanda e on e.id = r.envio_id
          where e.cuenta_id = $1 and r.rol = 'SALE' group by linea_id having count(*) > 1) x`,
        [cuenta],
      );
      expect(repetidas).toBe(0);
    }
  });

  it("P3: enviar a la vez que se quita una línea: la línea sale en ese envío o queda quitada, nunca las dos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { cuenta, lineas } = await m.cuentaConLineas(e, 2);
      const pedido = { envioId: nuevoId(), claveIdempotencia: nuevaClave() };
      const [quitar, envio] = await Promise.all([
        m.casosDeComandas.quitarSinEnviar(e.gerente, {
          cuentaId: cuenta,
          lineaId: lineas[0] as string,
        }),
        repetirSiAgotada(() => enviar(cuenta, pedido), { esAgotada: agotadaEnElResultado }),
      ]);
      expect(["ok", "LINEA_YA_ENVIADA"]).toContain(codigo(quitar));
      expect(["ok", "NADA_PARA_ENVIAR"]).toContain(codigo(envio));
      const filas = await m.filas<{
        estado: string;
        envio_id: string | null;
        motivo: string | null;
      }>(
        `select l.estado, d.envio_id, l.motivo_de_anulacion as motivo from linea_cuenta l
           left join linea_de_comanda d on d.linea_id = l.id where l.id = $1`,
        [lineas[0]],
      );
      const f = filas[0];
      // Nunca «enviada y quitada» a la vez.
      expect(f?.estado === "ANULADA" && f.envio_id !== null).toBe(false);
    }
  });

  it("pedir que salga es un envío más: repetirlo con la misma clave no lo duplica y lo ya enviado se ignora con aviso", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 3);
    const [a, b, c] = lineas as [string, string, string];
    valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: b,
        salida: "DESPUES",
      }),
    );
    valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: c,
        salida: "DESPUES",
      }),
    );
    // El envío manda solo lo que sale ahora; lo que espera va en el papel como «Sale después».
    const primero = valorDe(await enviar(cuenta));
    expect(primero).toMatchObject({ numero: 1, lineas: 1 });
    const renglones = await m.filas<{ rol: string }>(
      "select rol from renglon_de_envio where envio_id = $1 order by orden",
      [primero.envioId],
    );
    expect(renglones.map((r) => r.rol)).toEqual(["SALE", "ESPERA", "ESPERA"]);
    // «Hay platos sin pedir»: nada más que enviar.
    expect(codigo(await enviar(cuenta))).toBe("NADA_PARA_ENVIAR");
    const envioId = nuevoId();
    const clave = nuevaClave();
    const pedido = {
      envioId,
      cuentaId: cuenta,
      lineaIds: [b, a],
      rotulo: "Mesa 5",
      claveIdempotencia: clave,
    };
    const x = valorDe(await m.casosDeComandas.pedirQueSalga(e.gerente, pedido));
    expect(x).toMatchObject({
      numero: 2,
      tipo: "SALIDA_PEDIDA",
      lineas: 1,
      ignoradas: [a],
      yaExistia: false,
    });
    const y = valorDe(await m.casosDeComandas.pedirQueSalga(e.gerente, pedido));
    expect(y).toMatchObject({ envioId, numero: 2, yaExistia: true });
    expect(await numerosDeEnvio(cuenta)).toEqual([1, 2]);
    const todas = valorDe(
      await m.casosDeComandas.pedirQueSalga(e.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        lineaIds: "TODAS",
        rotulo: "Mesa 5",
        claveIdempotencia: nuevaClave(),
      }),
    );
    expect(todas).toMatchObject({ numero: 3, lineas: 1 });
    expect(
      codigo(
        await m.casosDeComandas.pedirQueSalga(e.gerente, {
          envioId: nuevoId(),
          cuentaId: cuenta,
          lineaIds: "TODAS",
          rotulo: "Mesa 5",
          claveIdempotencia: nuevaClave(),
        }),
      ),
    ).toBe("NADA_QUE_PEDIR");
  });

  it("quitar un plato sin enviar es libre y repetirlo devuelve yaEstabaQuitada; con el plato enviado, LINEA_YA_ENVIADA", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 2);
    const [a, b] = lineas as [string, string];
    const q1 = valorDe(
      await m.casosDeComandas.quitarSinEnviar(e.gerente, { cuentaId: cuenta, lineaId: a }),
    );
    expect(q1.yaEstabaQuitada).toBe(false);
    const q2 = valorDe(
      await m.casosDeComandas.quitarSinEnviar(e.gerente, { cuentaId: cuenta, lineaId: a }),
    );
    expect(q2.yaEstabaQuitada).toBe(true);
    const motivo = await m.filas<{ motivo: string }>(
      "select motivo_de_anulacion as motivo from linea_cuenta where id = $1",
      [a],
    );
    expect(motivo[0]?.motivo).toBe("SIN_ENVIAR");
    valorDe(await enviar(cuenta));
    expect(
      codigo(await m.casosDeComandas.quitarSinEnviar(e.gerente, { cuentaId: cuenta, lineaId: b })),
    ).toBe("LINEA_YA_ENVIADA");
    // No se imprimió nada por quitar sin enviar.
    expect(
      await m.contar("select count(*) as n from aviso_de_anulacion where cuenta_id = $1", [cuenta]),
    ).toBe(0);
  });

  it("cambiar «sale después» solo vale sin enviar; repetir la misma salida no cambia nada", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1);
    const linea = lineas[0] as string;
    const a = valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        salida: "DESPUES",
      }),
    );
    expect(a).toEqual({ salida: "DESPUES", yaEstaba: false });
    const b = valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        salida: "DESPUES",
      }),
    );
    expect(b.yaEstaba).toBe(true);
    valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        salida: "AHORA",
      }),
    );
    valorDe(await enviar(cuenta));
    expect(
      codigo(
        await m.casosDeComandas.cambiarSalida(e.gerente, {
          cuentaId: cuenta,
          lineaId: linea,
          salida: "DESPUES",
        }),
      ),
    ).toBe("LINEA_YA_ENVIADA");
    expect(
      codigo(
        await m.casosDeComandas.cambiarSalida(e.gerente, {
          cuentaId: cuenta,
          lineaId: linea,
          salida: "NUNCA" as never,
        }),
      ),
    ).toBe("SALIDA_INVALIDA");
  });

  it("P12: anular parte de un ítem enviado con el precio del catálogo cambiado: el resto conserva el precio congelado, un aviso y una anulación, y el doble clic no duplica", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1, "3");
    const linea = lineas[0] as string;
    valorDe(await enviar(cuenta));
    // El catálogo sube de precio en el medio: lo ya vendido no se recotiza.
    await m.precio({
      empresa: e.empresa,
      producto: e.producto,
      precio: "1500",
      desde: "2026-11-09T14:00:00Z",
    });
    const avisoId = nuevoId();
    const entrada = {
      cuentaId: cuenta,
      lineaId: linea,
      cantidad: "1",
      motivo: "El cliente se arrepintió",
      avisoId,
      rotulo: "Mesa 5",
    };
    const a = valorDe(await m.casosDeComandas.anularItemEnviado(e.gerente, entrada));
    expect(a).toMatchObject({ avisoId, quedan: "2.0000", yaExistia: false, sinImpresora: true });
    expect(a.lineaDelResto).not.toBeNull();
    // Doble clic (mismo aviso y otro aviso sobre la misma línea): lo mismo, sin escribir de nuevo.
    const b = valorDe(await m.casosDeComandas.anularItemEnviado(e.gerente, entrada));
    expect(b).toMatchObject({ avisoId, yaExistia: true, lineaDelResto: a.lineaDelResto });
    const c = valorDe(
      await m.casosDeComandas.anularItemEnviado(e.gerente, { ...entrada, avisoId: nuevoId() }),
    );
    expect(c).toMatchObject({ avisoId, yaExistia: true });
    expect(
      await m.contar("select count(*) as n from aviso_de_anulacion where cuenta_id = $1", [cuenta]),
    ).toBe(1);
    expect(
      await m.contar(
        "select count(*) as n from trabajo_de_impresion where documento_tipo = 'ANULACION' and documento_id = $1",
        [avisoId],
      ),
    ).toBe(1);
    // El resto: misma cuenta, precio congelado, sigue en su envío (no se reimprime) y el total cierra al centavo.
    const resto = await m.filas<{
      precio_unitario: string;
      cantidad: string;
      estado: string;
      envio_id: string | null;
    }>(
      `select l.precio_unitario::text, l.cantidad::text, l.estado, d.envio_id
         from linea_cuenta l join linea_de_comanda d on d.linea_id = l.id where l.id = $1`,
      [a.lineaDelResto],
    );
    expect(resto[0]).toMatchObject({
      precio_unitario: "1000.000000",
      cantidad: "2.0000",
      estado: "VIGENTE",
    });
    expect(resto[0]?.envio_id).not.toBeNull();
    const total = await m.filas<{ t: string }>(
      "select total_provisorio::text as t from cuenta_consumo where id = $1",
      [cuenta],
    );
    expect(total[0]?.t).toBe("2000.00");
    expect(await numerosDeEnvio(cuenta)).toEqual([1]);
    // El control de cierre cuenta la anulación parcial con su motivo real.
    const anuladas = await m.filas<{ motivo: string }>(
      "select motivo_de_anulacion as motivo from linea_cuenta where id = $1",
      [linea],
    );
    expect(anuladas[0]?.motivo).toBe("El cliente se arrepintió");
    // Total: anular lo que queda del resto, entero.
    const d = valorDe(
      await m.casosDeComandas.anularItemEnviado(e.gerente, {
        cuentaId: cuenta,
        lineaId: a.lineaDelResto as string,
        cantidad: "2",
        motivo: "Se fue la mesa",
        avisoId: nuevoId(),
        rotulo: "Mesa 5",
      }),
    );
    expect(d).toMatchObject({ quedan: "0.0000", lineaDelResto: null });
    // Un ítem que no salió a cocina se quita sin trámite, no se anula con aviso.
    const sin = await m.cuentaConLineas(e, 1);
    expect(
      codigo(
        await m.casosDeComandas.anularItemEnviado(e.gerente, {
          ...entrada,
          cuentaId: sin.cuenta,
          lineaId: sin.lineas[0] as string,
          avisoId: nuevoId(),
        }),
      ),
    ).toBe("LINEA_NO_ENVIADA");
    // Sin motivo no se anula; una cantidad de más tampoco.
    const otra = await m.cuentaConLineas(e, 1, "2");
    valorDe(await enviar(otra.cuenta));
    const base2 = { cuentaId: otra.cuenta, lineaId: otra.lineas[0] as string, rotulo: "Mesa 5" };
    expect(
      codigo(
        await m.casosDeComandas.anularItemEnviado(e.gerente, {
          ...base2,
          cantidad: "1",
          motivo: "",
          avisoId: nuevoId(),
        }),
      ),
    ).toBe("MOTIVO_OBLIGATORIO");
    expect(
      codigo(
        await m.casosDeComandas.anularItemEnviado(e.gerente, {
          ...base2,
          cantidad: "3",
          motivo: "Error",
          avisoId: nuevoId(),
        }),
      ),
    ).toBe("CANTIDAD_INVALIDA");
    expect(
      codigo(
        await m.casosDeComandas.anularItemEnviado(e.gerente, {
          ...base2,
          cantidad: "1",
          motivo: "<b>x</b>",
          avisoId: nuevoId(),
        }),
      ),
    ).toBe("MOTIVO_INVALIDO");
  });

  it("P17: un envío a la 01:25 con corte a las 06:00 pertenece a la jornada del día anterior y la copia muestra la hora del envío original", async () => {
    const x = await m.escenario();
    await m.dueno.query("update sucursal set hora_de_corte = '06:00' where id = $1", [x.sucursal]);
    const { cuenta } = await m.cuentaConLineas(x, 1);
    const alba = { ...x.gerente, ahora: new Date("2026-11-09T04:25:00Z") }; // 01:25 en Argentina
    const envio = valorDe(
      await m.casosDeComandas.enviarACocina(alba, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        rotulo: "Mesa 7",
        claveIdempotencia: nuevaClave(),
      }),
    );
    expect(envio.fechaNegocio).toBe("2026-11-08");
    // La copia sale más tarde, pero el papel dice la hora del envío original.
    const tarde = { ...x.gerente, ahora: new Date("2026-11-09T21:00:00Z") };
    const papel = valorDe(
      await m.consultasDeComandas.documentoParaImprimir(tarde, {
        documentoTipo: "COMANDA",
        documentoId: envio.envioId,
        copia: true,
      }),
    );
    const texto = papel.lineas.map((l) => l.texto).join("\n");
    expect(texto).toContain("09/11/2026 01:25");
    expect(texto).toContain("Copia");
    expect(texto).toContain("Mesa 7");
    expect(texto).not.toMatch(/\$|precio/i);
  });

  it("P13: otra empresa o sucursal es inexistente, el alcance y el permiso se exigen primero y el módulo en desarrollo no deja nada", async () => {
    const otra = await m.escenario();
    const { cuenta } = await m.cuentaConLineas(e, 1);
    // Otra empresa ve la cuenta como inexistente.
    expect(codigo(await enviar(cuenta, {}, otra.gerente))).toBe("CUENTA_NO_ENCONTRADA");
    // El operador solo opera en su sucursal: una cuenta de la otra sucursal está fuera de su alcance.
    const norte = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: norte, sucursalId: e.otraSucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: norte,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    expect(codigo(await enviar(norte, {}, e.operador))).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    // Sin persona en el contexto no hay quién deje constancia.
    expect(["SIN_PERMISO", "MODULO_NO_ACTIVO"]).toContain(
      codigo(await enviar(cuenta, {}, { ...e.gerente, personaId: null })),
    );
    // Guard primero: con el catálogo real `comandas` está en desarrollo.
    const r = await m.casosReales.enviarACocina(e.gerente, {
      envioId: nuevoId(),
      cuentaId: cuenta,
      rotulo: "Mesa 5",
      claveIdempotencia: nuevaClave(),
    });
    expect(r.ok).toBe(false);
    expect(
      await m.contar("select count(*) as n from envio_de_comanda where cuenta_id = $1", [cuenta]),
    ).toBe(0);
    // Entradas mal formadas: ni un id, ni un rótulo, ni una clave inválidos llegan a la base.
    expect(codigo(await enviar("no-es-un-uuid"))).toBe("IDENTIFICADOR_INVALIDO");
    expect(codigo(await enviar(cuenta, { rotulo: "<script>" }))).toBe("ROTULO_INVALIDO");
    expect(codigo(await enviar(cuenta, { claveIdempotencia: "corta" }))).toBe("CLAVE_INVALIDA");
    // Una cuenta cerrada no recibe envíos.
    const fin = await m.cuentaConLineas(e, 1);
    valorDe(
      await m.casos.anularLinea(e.gerente, {
        cuentaId: fin.cuenta,
        lineaId: fin.lineas[0] as string,
        motivo: "Error",
      }),
    );
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: fin.cuenta, motivo: "Se fue" }));
    expect(codigo(await enviar(fin.cuenta))).toBe("CUENTA_NO_ABIERTA");
  });
});

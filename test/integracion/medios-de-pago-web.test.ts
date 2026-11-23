import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  agregarElMedioDePago,
  cambiarLosDatosDelMedio,
  desactivarElMedioDePago,
  editarElMedioDePago,
  listarLosMediosDePago,
  reactivarElMedioDePago,
  type DependenciasDeMediosDePagoWeb,
  type MedioParaLaPantalla,
} from "../../src/composicion/medios-de-pago-web";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  crearMundoDeCaja,
  sumarPersona,
  type MundoDeCaja,
} from "./caja-configuracion-apoyo";

/**
 * «Medios de pago» de la web (`medios-de-pago-web.ts`) contra una base real y los roles reales: lo que la pantalla recibe, cada error con su código público
 * (el nombre repetido y el genérico), que repetir no duplica, que dos a la vez no se pisan, que lo de otra empresa no existe y que el permiso lo decide el
 * caso de uso. Los casos de uso en sí (guard, auditoría, concurrencia del dominio) tienen sus pruebas en `caja-configuracion-*.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

const SIN_DATOS = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };

describe.skipIf(base === null)("medios de pago de la web", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let d: DependenciasDeMediosDePagoWeb;
  let registrados: string[];

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    const caja = armarCaja(entorno);
    registrados = [];
    d = {
      casosDeUso: () => caja.casos,
      consultas: () => caja.consultas,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const mundo = () => crearMundoDeCaja(entornoBase, dueno);
  const lista = async (m: MundoDeCaja): Promise<readonly MedioParaLaPantalla[]> => {
    const r = await listarLosMediosDePago(d, m.ctx());
    if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
    return r.dato.medios;
  };
  const alta = async (m: MundoDeCaja, tipo: string, nombre: string | null = null) => {
    const r = await agregarElMedioDePago(d, m.ctx(), { tipo, nombre });
    if (!r.ok) throw new Error(`se esperaba el alta y vino ${r.error.codigo}`);
    return r.dato.medioDePagoId;
  };
  const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? "OK" : (r.error?.codigo ?? "?");
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number(((await dueno.query<{ n: string }>(texto, parametros)).rows[0] ?? { n: "0" }).n);

  it("la lista trae TODOS los medios de la empresa, también los desactivados, y solo id, tipo, nombre, estado, versión y los datos que el tipo admite", async () => {
    const m = await mundo();
    const qr = await alta(m, "QR", "Mercado Pago");
    await alta(m, "TRANSFERENCIA");
    expect((await desactivarElMedioDePago(d, m.ctx(), { medioDePagoId: qr })).ok).toBe(true);
    const medios = await lista(m);
    expect(medios.map((x) => [x.tipo, x.nombre, x.activo]).sort()).toEqual(
      [
        ["QR", "Mercado Pago", false],
        ["TRANSFERENCIA", null, true],
      ].sort(),
    );
    for (const medio of medios) {
      expect(Object.keys(medio).sort()).toEqual([
        "activo",
        "datos",
        "id",
        "nombre",
        "tipo",
        "version",
      ]);
    }
  });

  it("agregar un medio: queda activo y sin nombre en blanco; un nombre vacío o en blanco es «sin nombre propio»", async () => {
    const m = await mundo();
    await alta(m, "TARJETA_DEBITO", "   ");
    await alta(m, "TARJETA_CREDITO", "");
    const medios = await lista(m);
    expect(medios.map((x) => [x.tipo, x.nombre, x.activo]).sort()).toEqual(
      [
        ["TARJETA_CREDITO", null, true],
        ["TARJETA_DEBITO", null, true],
      ].sort(),
    );
  });

  it("repetir el alta no duplica ni audita dos veces (clic doble, reintento): el mismo id y una sola fila", async () => {
    const m = await mundo();
    const uno = await alta(m, "QR", "Mercado Pago");
    const dos = await alta(m, "QR", "Mercado Pago");
    expect(dos).toBe(uno);
    expect(await lista(m)).toHaveLength(1);
    expect(
      await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'MEDIO_DE_PAGO_CREADO'",
        [m.empresa],
      ),
    ).toBe(1);
  });

  it("dos altas iguales a la vez dejan un solo medio", async () => {
    const m = await mundo();
    const [a, b] = await Promise.all([
      agregarElMedioDePago(d, m.ctx(), { tipo: "QR", nombre: "Mercado Pago" }),
      agregarElMedioDePago(d, m.ctx(), { tipo: "QR", nombre: "Mercado Pago" }),
    ]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await lista(m)).toHaveLength(1);
  });

  it("el nombre repetido de otro tipo es CAJA_MEDIO_REPETIDO; el tipo inválido, el efectivo repetido y un pedido sin forma, el genérico", async () => {
    const m = await mundo();
    await alta(m, "QR", "Mercado Pago");
    expect(
      codigoDe(await agregarElMedioDePago(d, m.ctx(), { tipo: "OTRO", nombre: "Mercado Pago" })),
    ).toBe("CAJA_MEDIO_REPETIDO");
    expect(
      codigoDe(await agregarElMedioDePago(d, m.ctx(), { tipo: "BITCOIN", nombre: null })),
    ).toBe("CAJA_ACCION_NO_PERMITIDA");
    await alta(m, "EFECTIVO");
    expect(
      codigoDe(await agregarElMedioDePago(d, m.ctx(), { tipo: "EFECTIVO", nombre: "Caja chica" })),
    ).toBe("CAJA_ACCION_NO_PERMITIDA");
    expect(codigoDe(await agregarElMedioDePago(d, m.ctx(), "no es un objeto"))).toBe(
      "CAJA_ACCION_NO_PERMITIDA",
    );
    expect(codigoDe(await agregarElMedioDePago(d, m.ctx(), { nombre: "x" }))).toBe(
      "CAJA_ACCION_NO_PERMITIDA",
    );
    expect(await lista(m)).toHaveLength(2);
  });

  it("un medio desactivado con ese nombre sigue existiendo: el mismo CAJA_MEDIO_REPETIDO (se lo reactiva, no se crea otro)", async () => {
    const m = await mundo();
    const id = await alta(m, "QR", "Mercado Pago");
    await desactivarElMedioDePago(d, m.ctx(), { medioDePagoId: id });
    expect(
      codigoDe(await agregarElMedioDePago(d, m.ctx(), { tipo: "QR", nombre: "Mercado Pago" })),
    ).toBe("CAJA_MEDIO_REPETIDO");
    expect((await reactivarElMedioDePago(d, m.ctx(), { medioDePagoId: id })).ok).toBe(true);
    expect((await lista(m)).map((x) => x.activo)).toEqual([true]);
  });

  it("editar cambia solo el nombre y conserva los datos del cobro; con la versión vieja no escribe y sale el genérico", async () => {
    const m = await mundo();
    const id = await alta(m, "TARJETA_DEBITO");
    const inicial = (await lista(m))[0] as MedioParaLaPantalla;
    // Los datos del cobro se cargan con su propia acción (decisión 129); acá se hace por el caso de uso para probar que editar el nombre los conserva.
    const conDatos = await armarCaja(entorno).casos.editarMedioDePago(m.ctx(), {
      medioDePagoId: id,
      versionEsperada: inicial.version,
      nombre: null,
      datos: { ...SIN_DATOS, cupon: true, ultimos4: true },
    });
    expect(conDatos.ok).toBe(true);
    const vigente = (await lista(m))[0] as MedioParaLaPantalla;

    const editado = await editarElMedioDePago(d, m.ctx(), {
      medioDePagoId: id,
      versionEsperada: vigente.version,
      nombre: "Posnet del salón",
    });
    expect(editado.ok).toBe(true);
    const despues = (await lista(m))[0] as MedioParaLaPantalla;
    expect(despues.nombre).toBe("Posnet del salón");
    expect(despues.version).toBeGreaterThan(vigente.version);
    const guardado = await dueno.query<{ pide_cupon: boolean; pide_ultimos4: boolean }>(
      "select * from medio_de_pago where id = $1",
      [id],
    );
    expect(Object.values(guardado.rows[0] ?? {})).toContain(true);

    const vieja = await editarElMedioDePago(d, m.ctx(), {
      medioDePagoId: id,
      versionEsperada: vigente.version,
      nombre: "Otro nombre",
    });
    expect(codigoDe(vieja)).toBe("CAJA_ACCION_NO_PERMITIDA");
    expect((await lista(m))[0]?.nombre).toBe("Posnet del salón");
  });

  it("dos ediciones a la vez con la misma versión: una gana y la otra recibe el genérico sin pisar", async () => {
    const m = await mundo();
    const id = await alta(m, "TRANSFERENCIA");
    const version = ((await lista(m))[0] as MedioParaLaPantalla).version;
    const [a, b] = await Promise.all([
      editarElMedioDePago(d, m.ctx(), {
        medioDePagoId: id,
        versionEsperada: version,
        nombre: "Uno",
      }),
      editarElMedioDePago(d, m.ctx(), {
        medioDePagoId: id,
        versionEsperada: version,
        nombre: "Dos",
      }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(["Uno", "Dos"]).toContain((await lista(m))[0]?.nombre);
  });

  it("los datos que se piden al cobrar: la lista trae solo los que el TIPO admite, todos apagados en un medio nuevo", async () => {
    const m = await mundo();
    for (const tipo of ["TARJETA_DEBITO", "TARJETA_CREDITO", "TRANSFERENCIA", "QR", "OTRO"]) {
      await alta(m, tipo);
    }
    const porTipo = new Map((await lista(m)).map((x) => [x.tipo, x.datos]));
    const apagados = (...datos: string[]) => datos.map((dato) => ({ dato, pide: false }));
    expect(porTipo.get("TARJETA_DEBITO")).toEqual(apagados("cupon", "ultimos4", "marca"));
    expect(porTipo.get("TARJETA_CREDITO")).toEqual(
      apagados("cupon", "ultimos4", "marca", "cuotas"),
    );
    expect(porTipo.get("TRANSFERENCIA")).toEqual(apagados("dni"));
    expect(porTipo.get("QR")).toEqual([]);
    expect(porTipo.get("OTRO")).toEqual([]);
  });

  it("cambiar los datos del cobro: guarda el conjunto final, conserva el nombre y audita; repetirlo no escribe ni audita de nuevo", async () => {
    const m = await mundo();
    const id = await alta(m, "TARJETA_CREDITO", "Posnet");
    const v0 = ((await lista(m))[0] as MedioParaLaPantalla).version;
    const auditorias = () =>
      contar(
        "select count(*) as n from auditoria_empresa where accion = 'MEDIO_DE_PAGO_EDITADO' and entidad_id = $1",
        [id],
      );
    const pedido = { medioDePagoId: id, versionEsperada: v0, datos: ["cupon", "cuotas"] };
    const primera = await cambiarLosDatosDelMedio(d, m.ctx(), pedido);
    expect(primera.ok).toBe(true);
    const medio = (await lista(m))[0] as MedioParaLaPantalla;
    expect(medio.nombre).toBe("Posnet");
    expect(medio.datos.filter((x) => x.pide).map((x) => x.dato)).toEqual(["cupon", "cuotas"]);
    expect(medio.version).toBeGreaterThan(v0);
    expect(await auditorias()).toBe(1);
    // Clic doble o reintento: el mismo pedido otra vez (con la versión que ya quedó vieja) no escribe ni audita.
    const repetida = await cambiarLosDatosDelMedio(d, m.ctx(), pedido);
    expect(repetida.ok).toBe(true);
    expect(await auditorias()).toBe(1);
    expect(((await lista(m))[0] as MedioParaLaPantalla).version).toBe(medio.version);
    // Apagar todo es válido: el medio vuelve a no pedir nada.
    const apagado = await cambiarLosDatosDelMedio(d, m.ctx(), {
      medioDePagoId: id,
      versionEsperada: medio.version,
      datos: [],
    });
    expect(apagado.ok).toBe(true);
    expect(((await lista(m))[0] as MedioParaLaPantalla).datos.some((x) => x.pide)).toBe(false);
  });

  it("cambiar los datos del cobro: lo que el tipo no admite, un dato desconocido y un pedido sin forma salen sin escribir", async () => {
    const m = await mundo();
    const transferencia = await alta(m, "TRANSFERENCIA");
    const qr = await alta(m, "QR");
    const version = async (id: string) =>
      ((await lista(m)).find((x) => x.id === id) as MedioParaLaPantalla).version;
    // La transferencia no admite cupón; el QR no admite ninguno (el servidor lo rechaza aunque la pantalla no lo ofrezca).
    expect(
      codigoDe(
        await cambiarLosDatosDelMedio(d, m.ctx(), {
          medioDePagoId: transferencia,
          versionEsperada: await version(transferencia),
          datos: ["cupon"],
        }),
      ),
    ).toBe("CAJA_ACCION_NO_PERMITIDA");
    expect(
      codigoDe(
        await cambiarLosDatosDelMedio(d, m.ctx(), {
          medioDePagoId: qr,
          versionEsperada: await version(qr),
          datos: ["dni"],
        }),
      ),
    ).toBe("CAJA_ACCION_NO_PERMITIDA");
    for (const datos of [["cliente"], ["__proto__"], "cupon", [1], null]) {
      const r = await cambiarLosDatosDelMedio(d, m.ctx(), {
        medioDePagoId: transferencia,
        versionEsperada: await version(transferencia),
        datos,
      });
      expect(r.ok, JSON.stringify(datos)).toBe(false);
    }
    expect(await cambiarLosDatosDelMedio(d, m.ctx(), "no es un pedido")).toMatchObject({
      ok: false,
    });
    expect((await lista(m)).flatMap((x) => x.datos).filter((x) => x.pide)).toEqual([]);
  });

  it("cambiar los datos del cobro con la versión vieja no escribe; dos cambios a la vez con la misma versión: uno gana y el otro no pisa", async () => {
    const m = await mundo();
    const id = await alta(m, "TARJETA_DEBITO");
    const version = ((await lista(m))[0] as MedioParaLaPantalla).version;
    const [a, b] = await Promise.all([
      cambiarLosDatosDelMedio(d, m.ctx(), {
        medioDePagoId: id,
        versionEsperada: version,
        datos: ["cupon"],
      }),
      cambiarLosDatosDelMedio(d, m.ctx(), {
        medioDePagoId: id,
        versionEsperada: version,
        datos: ["marca"],
      }),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const pide = ((await lista(m))[0] as MedioParaLaPantalla).datos
      .filter((x) => x.pide)
      .map((x) => x.dato);
    expect(pide).toHaveLength(1);
    expect(["cupon", "marca"]).toContain(pide[0]);
    // Con la versión que ya quedó vieja, nada se escribe.
    const vieja = await cambiarLosDatosDelMedio(d, m.ctx(), {
      medioDePagoId: id,
      versionEsperada: version,
      datos: ["ultimos4"],
    });
    expect(codigoDe(vieja)).toBe("CAJA_ACCION_NO_PERMITIDA");
    expect(
      ((await lista(m))[0] as MedioParaLaPantalla).datos.filter((x) => x.pide).map((x) => x.dato),
    ).toEqual(pide);
  });

  it("cambiar los datos del cobro: el operador no puede (SIN_PERMISO) y un medio de otra empresa no existe", async () => {
    const m = await mundo();
    const otra = await mundo();
    const id = await alta(m, "TARJETA_DEBITO");
    const ajeno = await alta(otra, "TARJETA_DEBITO");
    const version = ((await lista(m))[0] as MedioParaLaPantalla).version;
    const operador = await sumarPersona(dueno, m, "OPERADOR", true);
    expect(
      codigoDe(
        await cambiarLosDatosDelMedio(d, operador(), {
          medioDePagoId: id,
          versionEsperada: version,
          datos: ["cupon"],
        }),
      ),
    ).toBe("SIN_PERMISO");
    const aVer = ((await lista(otra))[0] as MedioParaLaPantalla).version;
    expect(
      codigoDe(
        await cambiarLosDatosDelMedio(d, m.ctx(), {
          medioDePagoId: ajeno,
          versionEsperada: aVer,
          datos: ["cupon"],
        }),
      ),
    ).toBe("CAJA_ACCION_NO_PERMITIDA");
    expect((await lista(m)).flatMap((x) => x.datos).some((x) => x.pide)).toBe(false);
    expect((await lista(otra)).flatMap((x) => x.datos).some((x) => x.pide)).toBe(false);
  });

  it("desactivar y reactivar son botones distintos y cada uno es un solo efecto aunque se repita; el efectivo no se desactiva", async () => {
    const m = await mundo();
    const id = await alta(m, "QR");
    for (let i = 0; i < 2; i++) {
      expect((await desactivarElMedioDePago(d, m.ctx(), { medioDePagoId: id })).ok).toBe(true);
    }
    expect(
      await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'MEDIO_DE_PAGO_DESACTIVADO'",
        [m.empresa],
      ),
    ).toBe(1);
    for (let i = 0; i < 2; i++) {
      expect((await reactivarElMedioDePago(d, m.ctx(), { medioDePagoId: id })).ok).toBe(true);
    }
    const efectivo = await alta(m, "EFECTIVO");
    expect(codigoDe(await desactivarElMedioDePago(d, m.ctx(), { medioDePagoId: efectivo }))).toBe(
      "CAJA_ACCION_NO_PERMITIDA",
    );
    expect((await lista(m)).find((x) => x.id === efectivo)?.activo).toBe(true);
  });

  it("aislamiento: un medio de otra empresa no se ve ni se toca (el mismo genérico que uno inexistente)", async () => {
    const a = await mundo();
    const b = await mundo();
    const ajeno = await alta(b, "QR", "Solo de B");
    expect((await lista(a)).map((x) => x.id)).not.toContain(ajeno);
    expect(codigoDe(await desactivarElMedioDePago(d, a.ctx(), { medioDePagoId: ajeno }))).toBe(
      "CAJA_ACCION_NO_PERMITIDA",
    );
    expect(
      codigoDe(
        await editarElMedioDePago(d, a.ctx(), {
          medioDePagoId: ajeno,
          versionEsperada: 1,
          nombre: "Robado",
        }),
      ),
    ).toBe("CAJA_ACCION_NO_PERMITIDA");
    expect((await lista(b)).find((x) => x.id === ajeno)?.nombre).toBe("Solo de B");
  });

  it("la empresa del pedido no cuenta: manda la del contexto del servidor", async () => {
    const a = await mundo();
    const b = await mundo();
    const r = await agregarElMedioDePago(d, a.ctx(), {
      tipo: "QR",
      nombre: null,
      empresaId: b.empresa,
    });
    expect(r.ok).toBe(true);
    expect(await lista(a)).toHaveLength(1);
    expect(await lista(b)).toHaveLength(0);
  });

  it("el permiso lo decide el servidor: el operador ve la lista pero no agrega, edita ni desactiva (SIN_PERMISO) y nada se escribe", async () => {
    const m = await mundo();
    const id = await alta(m, "QR");
    const operador = await sumarPersona(dueno, m, "OPERADOR", true);
    expect((await listarLosMediosDePago(d, operador())).ok).toBe(true);
    expect(
      codigoDe(await agregarElMedioDePago(d, operador(), { tipo: "OTRO", nombre: null })),
    ).toBe("SIN_PERMISO");
    expect(codigoDe(await desactivarElMedioDePago(d, operador(), { medioDePagoId: id }))).toBe(
      "SIN_PERMISO",
    );
    expect(
      codigoDe(
        await editarElMedioDePago(d, operador(), {
          medioDePagoId: id,
          versionEsperada: 1,
          nombre: "X",
        }),
      ),
    ).toBe("SIN_PERMISO");
    expect(await lista(m)).toHaveLength(1);
  });

  it("un fallo inesperado sale sin detalle y con referencia; el detalle va al registro del servidor", async () => {
    const m = await mundo();
    const roto: DependenciasDeMediosDePagoWeb = {
      ...d,
      consultas: () => {
        throw new Error("la base dijo: relation medio_de_pago_x does not exist");
      },
    };
    const r = await listarLosMediosDePago(roto, m.ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r.error)).not.toContain("relation");
    expect(r.error.referencia).toMatch(/^PD-/);
    expect(registrados.some((x) => x.includes("relation medio_de_pago_x"))).toBe(true);
  });
});

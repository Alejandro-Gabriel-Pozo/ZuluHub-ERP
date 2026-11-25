import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  desactivarLaParte,
  fichaDeLaParte,
  guardarLaParte,
  listarLasPartes,
  reactivarLaParte,
  type DependenciasDeDirectorioWeb,
} from "../../src/composicion/directorio-web";
import { comoEmpresa, cuitUnico } from "./entorno";
import {
  montarClientes,
  nombreUnico,
  nuevoId,
  RONDAS,
  type EscenarioDeClientes,
  type MontajeDeClientes,
} from "./clientes-apoyo";

/**
 * La pantalla «Clientes y proveedores» de la web (`directorio-web.ts`) contra una base real y los roles reales: lo que la pantalla guarda y lee. Idempotencia del alta y de desactivar,
 * concurrencia (dos altas con el mismo documento, dos ediciones con la misma versión), forma de los datos (CUIT con guiones, provincia), aislamiento entre empresas, permisos del servidor y
 * el aviso de posibles duplicados. Lo que se prueba pasa por la misma función que llama la pantalla.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = "CLIENTES_ACCION_NO_PERMITIDA";
const codigo = (r: { ok: boolean; error?: { codigo: string } }): string | null =>
  r.ok ? null : (r.error?.codigo ?? null);
const conGuiones = (cuit: string): string =>
  `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;

describe.skipIf(base === null)("directorio de la web", () => {
  let c: MontajeDeClientes;
  let e: EscenarioDeClientes;
  let otra: EscenarioDeClientes;
  let d: DependenciasDeDirectorioWeb;
  let registrados: string[];
  beforeAll(async () => {
    if (base === null) return;
    c = await montarClientes(base);
    e = await c.escenario();
    otra = await c.escenario();
    registrados = [];
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Lo que manda el formulario de la pantalla, con lo mínimo de una empresa o una persona. */
  const formulario = (extra: Record<string, unknown> = {}) => ({
    idempotencia: nuevoId(),
    guardarIgual: true,
    naturaleza: "JURIDICA",
    nombre: nombreUnico("Empresa"),
    roles: ["PROVEEDOR"],
    ...extra,
  });
  const guardar = (extra: Record<string, unknown> = {}, contexto = e.gerente) =>
    guardarLaParte(d, contexto, formulario(extra));
  const crearYLeer = async (extra: Record<string, unknown> = {}) => {
    const r = await guardar(extra);
    if (!r.ok || r.dato.estado !== "GUARDADA") {
      throw new Error(`el alta no quedó guardada: ${JSON.stringify(r)} ${registrados.join("|")}`);
    }
    return r.dato.parteId;
  };
  const partesConNombre = (empresa: string, nombre: string) =>
    c.contar("select count(*) as n from parte where empresa_id = $1 and nombre = $2", [
      empresa,
      nombre,
    ]);
  const partesConDocumento = async (empresa: string, numero: string) =>
    c.contar(
      "select count(*) as n from parte where empresa_id = $1 and documento_normalizado like $2",
      [empresa, `%${numero}`],
    );

  it("la lista y la ficha traen lo declarado, con el nombre armado por la composición", async () => {
    const nombre = nombreUnico("Marta");
    const id = await crearYLeer({
      naturaleza: "HUMANA",
      nombre,
      apellido: "Gómez",
      roles: ["CUSTOMER"],
    });
    const lista = await listarLasPartes(d, e.gerente, { texto: nombre });
    expect(lista).toMatchObject({ ok: true });
    if (!lista.ok) return;
    // HALLAZGO (no se toca acá): la consulta arma «Apellido Nombre» sin la coma que dibuja la maqueta («Apellido, Nombre»); la pantalla muestra lo que la composición entrega.
    expect(lista.dato.partes.map((p) => [p.id, p.nombre, p.roles, p.activa])).toEqual([
      [id, `Gómez ${nombre}`, ["CUSTOMER"], true],
    ]);
    const ficha = await fichaDeLaParte(d, e.gerente, id);
    expect(ficha).toMatchObject({
      ok: true,
      dato: { id, naturaleza: "HUMANA", nombre, apellido: "Gómez", activa: true, version: 1 },
    });
  });

  it("I1 IDEMPOTENCIA: el mismo alta dos veces con la misma clave deja UNA parte y UNA fila de auditoría", async () => {
    const entrada = formulario();
    const [primera, segunda] = [
      await guardarLaParte(d, e.gerente, entrada),
      await guardarLaParte(d, e.gerente, entrada),
    ];
    expect(primera).toMatchObject({ ok: true, dato: { estado: "GUARDADA" } });
    expect(segunda).toMatchObject({ ok: true, dato: { estado: "GUARDADA" } });
    expect(await partesConNombre(e.empresa, entrada.nombre)).toBe(1);
    const creadas = await c.auditoria(e.empresa, "PARTE_CREADA");
    expect(
      creadas.filter(
        (f) =>
          f["entidad_id"] === (primera.ok && "parteId" in primera.dato ? primera.dato.parteId : ""),
      ),
    ).toHaveLength(1);
  });

  it("I1 el reintento SIN «Guardar igual» no escribe nada: avisa del parecido y deja la parte que ya había", async () => {
    const entrada = formulario({ guardarIgual: false });
    const primera = await guardarLaParte(d, e.gerente, entrada);
    expect(primera).toMatchObject({ ok: true, dato: { estado: "GUARDADA" } });
    const repetida = await guardarLaParte(d, e.gerente, entrada);
    expect(repetida).toMatchObject({ ok: true, dato: { estado: "DUPLICADOS" } });
    expect(await partesConNombre(e.empresa, entrada.nombre)).toBe(1);
  });

  it("I2 IDEMPOTENCIA: desactivar dos veces deja la parte inactiva y UNA auditoría; reactivar igual", async () => {
    const id = await crearYLeer();
    expect(await desactivarLaParte(d, e.gerente, { parteId: id })).toMatchObject({ ok: true });
    expect(await desactivarLaParte(d, e.gerente, { parteId: id })).toMatchObject({ ok: true });
    expect((await c.filas("select estado from parte where id = $1", [id]))[0]?.["estado"]).toBe(
      "INACTIVA",
    );
    const desactivadas = (await c.auditoria(e.empresa, "PARTE_DESACTIVADA")).filter(
      (f) => f["entidad_id"] === id,
    );
    expect(desactivadas).toHaveLength(1);
    expect(await reactivarLaParte(d, e.gerente, { parteId: id })).toMatchObject({ ok: true });
    expect(await reactivarLaParte(d, e.gerente, { parteId: id })).toMatchObject({ ok: true });
    const reactivadas = (await c.auditoria(e.empresa, "PARTE_REACTIVADA")).filter(
      (f) => f["entidad_id"] === id,
    );
    expect(reactivadas).toHaveLength(1);
  });

  it("I3 CONCURRENCIA: dos altas a la vez con el mismo CUIT: queda una y la otra vuelve con «documento ya registrado»", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const cuit = cuitUnico();
      c.armarBarrera(2);
      try {
        const [a, b] = await Promise.all([
          guardar({ documentoTipo: "CUIT", documentoNumero: cuit }),
          guardar({ documentoTipo: "CUIT", documentoNumero: conGuiones(cuit) }),
        ]);
        const resultados = [a, b];
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        expect(resultados.filter((r) => codigo(r) === "CLIENTES_DOCUMENTO_REPETIDO")).toHaveLength(
          1,
        );
        expect(await partesConDocumento(e.empresa, cuit)).toBe(1);
      } finally {
        c.soltarBarrera();
      }
    }
  });

  it("I3 CONCURRENCIA: dos ediciones a la vez con la misma versión: una gana y la otra falla entera", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const id = await crearYLeer({ roles: ["PROVEEDOR"] });
      const a = nombreUnico("Gana A");
      const b = nombreUnico("Gana B");
      c.armarBarrera(2);
      try {
        const [ra, rb] = await Promise.all([
          guardarLaParte(d, e.gerente, {
            ...formulario({ nombre: a, roles: ["CUSTOMER"] }),
            parteId: id,
            versionEsperada: 1,
          }),
          guardarLaParte(d, e.gerente, {
            ...formulario({ nombre: b, roles: ["CUSTOMER", "PROVEEDOR"] }),
            parteId: id,
            versionEsperada: 1,
          }),
        ]);
        expect([ra, rb].filter((r) => r.ok)).toHaveLength(1);
        expect([ra, rb].filter((r) => codigo(r) === GENERICO)).toHaveLength(1);
        const nombre = String(
          (await c.filas("select nombre from parte where id = $1", [id]))[0]?.["nombre"],
        );
        const roles = (
          await c.filas("select rol, activo from parte_rol where parte_id = $1 order by rol", [id])
        ).map((r) => `${String(r["rol"])}:${String(r["activo"])}`);
        // Una sola edición, entera: nombre y roles de la misma.
        if (nombre === a) expect(roles).toEqual(["CUSTOMER:true", "PROVEEDOR:false"]);
        else {
          expect(nombre).toBe(b);
          expect(roles).toEqual(["CUSTOMER:true", "PROVEEDOR:true"]);
        }
      } finally {
        c.soltarBarrera();
      }
    }
  });

  it("I3 una edición con la versión que ya cambió no pisa lo guardado", async () => {
    const id = await crearYLeer();
    const nuevo = nombreUnico("Primera");
    const primera = await guardarLaParte(d, e.gerente, {
      ...formulario({ nombre: nuevo }),
      parteId: id,
      versionEsperada: 1,
    });
    expect(primera).toMatchObject({ ok: true });
    const vieja = await guardarLaParte(d, e.gerente, {
      ...formulario({ nombre: nombreUnico("Segunda") }),
      parteId: id,
      versionEsperada: 1,
    });
    expect(codigo(vieja)).toBe(GENERICO);
    expect(
      String((await c.filas("select nombre from parte where id = $1", [id]))[0]?.["nombre"]),
    ).toBe(nuevo);
  });

  it("I4 FORMA DE LOS DATOS: un CUIT con guiones se guarda canónico y la provincia vuelve igual en la ficha", async () => {
    const cuit = cuitUnico();
    const id = await crearYLeer({
      documentoTipo: "CUIT",
      documentoNumero: conGuiones(cuit),
      calle: "Mitre",
      numero: "100",
      localidad: "Rosario",
      provincia: "AR-S",
      codigoPostal: "S2000",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      email: "contacto@example.com",
      telefono: "+54 11 4555 0101",
      nota: "Paga al contado",
    });
    const ficha = await fichaDeLaParte(d, e.gerente, id);
    expect(ficha).toMatchObject({
      ok: true,
      dato: {
        documento: { tipo: "CUIT", numero: cuit },
        domicilio: {
          calle: "Mitre",
          numero: "100",
          localidad: "Rosario",
          provincia: "AR-S",
          codigoPostal: "S2000",
        },
        condicionIva: "RESPONSABLE_INSCRIPTO",
        nota: "Paga al contado",
      },
    });
  });

  it("HALLAZGO: una nota con salto de línea hoy sale con el genérico (el dominio la acepta de UNA línea; la maqueta pide un texto de varias)", async () => {
    const r = await guardar({ nota: "Línea uno\nLínea dos" });
    expect(codigo(r)).toBe(GENERICO);
  });

  it("I4 un DNI con puntos se guarda canónico", async () => {
    const id = await crearYLeer({
      naturaleza: "HUMANA",
      nombre: nombreUnico("Raúl"),
      documentoTipo: "DNI",
      documentoNumero: "30.456.789",
    });
    const ficha = await fichaDeLaParte(d, e.gerente, id);
    expect(ficha).toMatchObject({
      ok: true,
      dato: { documento: { tipo: "DNI", numero: "30456789" } },
    });
  });

  it("I5 AISLAMIENTO: la ficha y la edición de una parte de OTRA empresa dan el genérico y no escriben; la lista no la trae", async () => {
    const ajena = await crearYLeer();
    const ficha = await fichaDeLaParte(d, otra.gerente, ajena);
    expect(codigo(ficha)).toBe(GENERICO);
    const antes = String(
      (await c.filas("select nombre from parte where id = $1", [ajena]))[0]?.["nombre"],
    );
    const edicion = await guardarLaParte(d, otra.gerente, {
      ...formulario({ nombre: nombreUnico("Robada") }),
      parteId: ajena,
      versionEsperada: 1,
    });
    expect(codigo(edicion)).toBe(GENERICO);
    expect(
      String((await c.filas("select nombre from parte where id = $1", [ajena]))[0]?.["nombre"]),
    ).toBe(antes);
    expect(codigo(await desactivarLaParte(d, otra.gerente, { parteId: ajena }))).toBe(GENERICO);
    const lista = await listarLasPartes(d, otra.gerente, { texto: antes });
    expect(lista).toMatchObject({ ok: true, dato: { partes: [] } });
  });

  it("I5 el mismo documento en dos empresas no choca (es único por empresa)", async () => {
    const cuit = cuitUnico();
    expect(await guardar({ documentoTipo: "CUIT", documentoNumero: cuit })).toMatchObject({
      ok: true,
    });
    expect(
      await guardar({ documentoTipo: "CUIT", documentoNumero: cuit }, otra.gerente),
    ).toMatchObject({ ok: true });
  });

  it("I6 PERMISOS: un operador no desactiva ni reactiva aunque llame directo; el estado no cambia", async () => {
    const id = await crearYLeer();
    const desactivar = await desactivarLaParte(d, e.operador, { parteId: id });
    expect(desactivar.ok).toBe(false);
    expect((await c.filas("select estado from parte where id = $1", [id]))[0]?.["estado"]).toBe(
      "ACTIVA",
    );
    await desactivarLaParte(d, e.gerente, { parteId: id });
    expect((await reactivarLaParte(d, e.operador, { parteId: id })).ok).toBe(false);
    expect((await c.filas("select estado from parte where id = $1", [id]))[0]?.["estado"]).toBe(
      "INACTIVA",
    );
  });

  it("I6 PERMISOS: quien no es de la empresa no da de alta ni lee", async () => {
    const intruso = comoEmpresa(e.empresaId, otra.personaDelOperador);
    const antes = await c.contar("select count(*) as n from parte where empresa_id = $1", [
      e.empresa,
    ]);
    expect((await guardar({}, intruso)).ok).toBe(false);
    expect((await listarLasPartes(d, intruso, {})).ok).toBe(false);
    expect(
      await c.contar("select count(*) as n from parte where empresa_id = $1", [e.empresa]),
    ).toBe(antes);
  });

  it("I6 el operador sí da de alta y edita", async () => {
    const id = await crearYLeer();
    expect(await guardar({}, e.operador)).toMatchObject({ ok: true });
    expect(
      await guardarLaParte(d, e.operador, {
        ...formulario({ nombre: nombreUnico("Editada") }),
        parteId: id,
        versionEsperada: 1,
      }),
    ).toMatchObject({ ok: true });
  });

  it("I7 DUPLICADOS: un alta con el mismo nombre no escribe y devuelve la coincidencia; con «Guardar igual» escribe", async () => {
    const nombre = nombreUnico("Repetida");
    const primera = await guardar({ nombre, guardarIgual: false });
    expect(primera).toMatchObject({ ok: true, dato: { estado: "GUARDADA" } });
    const otraConElMismoNombre = await guardar({ nombre, guardarIgual: false });
    expect(otraConElMismoNombre).toMatchObject({ ok: true, dato: { estado: "DUPLICADOS" } });
    if (otraConElMismoNombre.ok && otraConElMismoNombre.dato.estado === "DUPLICADOS") {
      expect(otraConElMismoNombre.dato.duplicados.map((x) => x.nombre)).toEqual([nombre]);
    }
    expect(await partesConNombre(e.empresa, nombre)).toBe(1);
    const igual = await guardar({ nombre, guardarIgual: true });
    expect(igual).toMatchObject({ ok: true, dato: { estado: "GUARDADA" } });
    expect(await partesConNombre(e.empresa, nombre)).toBe(2);
  });

  it("un documento repetido bloquea aunque se diga «Guardar igual»", async () => {
    const cuit = cuitUnico();
    expect(await guardar({ documentoTipo: "CUIT", documentoNumero: cuit })).toMatchObject({
      ok: true,
    });
    const repetido = await guardar({
      documentoTipo: "CUIT",
      documentoNumero: cuit,
      guardarIgual: true,
    });
    expect(codigo(repetido)).toBe("CLIENTES_DOCUMENTO_REPETIDO");
  });
});

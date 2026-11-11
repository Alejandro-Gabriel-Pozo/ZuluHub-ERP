import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitAlAzar } from "./entorno";
import {
  montarClientes,
  nombreAlAzar,
  nuevoId,
  valorDe,
  RONDAS,
  type EscenarioDeClientes,
  type MontajeDeClientes,
} from "./clientes-apoyo";

/**
 * E9-T4: roles, vínculos (contactos y agentes), las consultas del directorio y los puertos que ofrece a compras, contra la base real. Permisos por
 * rol, idempotencia, concurrencia (dos vínculos cruzados a la vez no se traban), aislamiento entre empresas y búsqueda (documento idéntico primero,
 * luego los nombres que empiezan y al final los que contienen; las desactivadas solo si se piden).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("clientes: roles, vínculos, consultas y puertos", () => {
  let c: MontajeDeClientes;
  let e: EscenarioDeClientes;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarClientes(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const persona = async (extra: Record<string, unknown> = {}, quien = e.operador) =>
    valorDe(
      await c.casos.crearParte(quien, {
        idempotencia: nuevoId(),
        naturaleza: "HUMANA",
        nombre: nombreAlAzar("Ana"),
        apellido: "López",
        roles: [],
        ...extra,
      }),
    ).parteId;
  const empresa = async (extra: Record<string, unknown> = {}, quien = e.operador) =>
    valorDe(
      await c.casos.crearParte(quien, {
        idempotencia: nuevoId(),
        naturaleza: "JURIDICA",
        nombre: nombreAlAzar("Empresa"),
        roles: ["PROVEEDOR"],
        ...extra,
      }),
    ).parteId;
  const rolesDe = async (parteId: string) =>
    (
      await c.filas("select rol, activo from parte_rol where parte_id = $1 order by rol", [parteId])
    ).map((r) => `${String(r["rol"])}:${String(r["activo"])}`);
  const vinculosDe = (parteId: string) =>
    c.filas("select * from parte_vinculo where parte_id = $1 or de_parte_id = $1", [parteId]);

  // =============================================================================================
  describe("cambiarRolesDeParte", () => {
    it("agrega, apaga y reactiva roles con el conjunto final; queda auditado", async () => {
      const id = await persona({ roles: ["CUSTOMER"] });
      expect(
        valorDe(
          await c.casos.cambiarRolesDeParte(e.operador, { parteId: id, roles: ["PROVEEDOR"] }),
        ),
      ).toEqual({ agregados: ["PROVEEDOR"], reactivados: [], quitados: ["CUSTOMER"] });
      expect(await rolesDe(id)).toEqual(["CUSTOMER:false", "PROVEEDOR:true"]);
      expect(
        valorDe(
          await c.casos.cambiarRolesDeParte(e.operador, {
            parteId: id,
            roles: ["CUSTOMER", "PROVEEDOR"],
          }),
        ),
      ).toEqual({ agregados: [], reactivados: ["CUSTOMER"], quitados: [] });
      expect(await rolesDe(id)).toEqual(["CUSTOMER:true", "PROVEEDOR:true"]);
      expect(
        (await c.auditoria(e.empresa, "PARTE_ROLES_CAMBIADOS")).filter(
          (r) => r["entidad_id"] === id,
        ),
      ).toHaveLength(2);
    });

    it("I12: pedir los roles que la parte ya tiene no escribe ni audita", async () => {
      const id = await persona({ roles: ["CUSTOMER", "PROVEEDOR"] });
      const antes = (await c.auditoria(e.empresa, "PARTE_ROLES_CAMBIADOS")).length;
      expect(
        valorDe(
          await c.casos.cambiarRolesDeParte(e.operador, {
            parteId: id,
            roles: ["PROVEEDOR", "CUSTOMER"],
          }),
        ),
      ).toEqual({ agregados: [], reactivados: [], quitados: [] });
      expect((await c.auditoria(e.empresa, "PARTE_ROLES_CAMBIADOS")).length).toBe(antes);
    });

    it("un rol que no existe, una parte ajena y una parte inexistente", async () => {
      const id = await persona();
      expect(
        await c.casos.cambiarRolesDeParte(e.operador, { parteId: id, roles: ["EMPLEADO"] }),
      ).toEqual({
        ok: false,
        error: "ROL_DE_PARTE_INVALIDO",
      });
      const otra = await c.escenario();
      for (const quien of [otra.gerente]) {
        expect(
          await c.casos.cambiarRolesDeParte(quien, { parteId: id, roles: ["CUSTOMER"] }),
        ).toEqual({
          ok: false,
          error: "PARTE_NO_ENCONTRADA",
        });
      }
      expect(
        await c.casos.cambiarRolesDeParte(e.operador, { parteId: nuevoId(), roles: [] }),
      ).toEqual({
        ok: false,
        error: "PARTE_NO_ENCONTRADA",
      });
    });

    it("dos pedidos de roles a la vez dejan los roles de uno de los dos, nunca una mezcla inválida", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const id = await persona();
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all([
            c.casos.cambiarRolesDeParte(e.operador, { parteId: id, roles: ["CUSTOMER"] }),
            c.casos.cambiarRolesDeParte(e.gerente, { parteId: id, roles: ["PROVEEDOR"] }),
          ]);
          expect(resultados.every((r) => r.ok || codigoDe(r) === "ConcurrenciaAgotada")).toBe(true);
        } finally {
          c.soltarBarrera();
        }
        const activos = (await rolesDe(id)).filter((r) => r.endsWith(":true"));
        expect(activos).toHaveLength(1);
      }
    });
  });

  // =============================================================================================
  describe("vincularContacto y desvincularContacto", () => {
    it("una persona es contacto de una empresa con su cargo; queda auditado", async () => {
      const contacto = await persona();
      const de = await empresa();
      expect(
        valorDe(
          await c.casos.vincularContacto(e.operador, {
            contactoId: contacto,
            deParteId: de,
            tipo: "CONTACTO",
            cargo: "Encargado de compras",
          }),
        ),
      ).toEqual({ yaExistia: false });
      expect(await vinculosDe(de)).toMatchObject([
        { tipo: "CONTACTO", cargo: "Encargado de compras", activo: true },
      ]);
      expect(
        (await c.auditoria(e.empresa, "PARTE_VINCULADA")).filter((r) => r["entidad_id"] === de),
      ).toHaveLength(1);
    });

    it("I13: vincular dos veces el mismo contacto deja un vínculo y devuelve yaExistia", async () => {
      const contacto = await persona();
      const de = await empresa();
      const entrada = { contactoId: contacto, deParteId: de, tipo: "AGENTE_DE", cargo: "Compras" };
      valorDe(await c.casos.vincularContacto(e.operador, entrada));
      const auditadas = (await c.auditoria(e.empresa, "PARTE_VINCULADA")).length;
      expect(valorDe(await c.casos.vincularContacto(e.operador, entrada))).toEqual({
        yaExistia: true,
      });
      expect(await vinculosDe(de)).toHaveLength(1);
      expect((await c.auditoria(e.empresa, "PARTE_VINCULADA")).length).toBe(auditadas);
    });

    it("I13: desvincular dos veces es ok y la segunda no escribe ni audita", async () => {
      const contacto = await persona();
      const de = await empresa();
      const clave = { contactoId: contacto, deParteId: de, tipo: "CONTACTO" };
      valorDe(await c.casos.vincularContacto(e.operador, { ...clave, cargo: "Ventas" }));
      expect(valorDe(await c.casos.desvincularContacto(e.operador, clave))).toEqual({
        yaEstaba: false,
      });
      const auditadas = (await c.auditoria(e.empresa, "PARTE_DESVINCULADA")).length;
      expect(valorDe(await c.casos.desvincularContacto(e.operador, clave))).toEqual({
        yaEstaba: true,
      });
      expect((await c.auditoria(e.empresa, "PARTE_DESVINCULADA")).length).toBe(auditadas);
      expect(await vinculosDe(de)).toMatchObject([{ activo: false }]);
      expect(
        valorDe(await c.casos.vincularContacto(e.operador, { ...clave, cargo: "Compras" })),
      ).toEqual({
        yaExistia: false,
      });
      expect(await vinculosDe(de)).toMatchObject([{ activo: true, cargo: "Compras" }]);
    });

    it("las reglas del dominio: nadie es contacto de sí mismo, solo una persona es contacto, el agente lo es de una empresa", async () => {
      const a = await persona();
      const b = await persona();
      const e1 = await empresa();
      const e2 = await empresa();
      const vincular = (contactoId: string, deParteId: string, tipo = "CONTACTO") =>
        c.casos.vincularContacto(e.operador, { contactoId, deParteId, tipo });
      expect(await vincular(a, a)).toEqual({ ok: false, error: "VINCULO_CONSIGO_MISMA" });
      expect(await vincular(e1, e2)).toEqual({ ok: false, error: "CONTACTO_DEBE_SER_HUMANA" });
      expect(await vincular(a, b, "AGENTE_DE")).toEqual({
        ok: false,
        error: "VINCULO_DEBE_SER_CON_EMPRESA",
      });
      expect(await vincular(a, b)).toEqual({ ok: true, valor: { yaExistia: false } });
      expect(await vincular(a, e1, "JEFE_DE")).toEqual({
        ok: false,
        error: "TIPO_DE_VINCULO_INVALIDO",
      });
      expect(await vincular(a, nuevoId())).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
      expect(
        await c.casos.vincularContacto(e.operador, {
          contactoId: a,
          deParteId: e1,
          tipo: "CONTACTO",
          cargo: "<b>",
        }),
      ).toEqual({ ok: false, error: "CARGO_INVALIDO" });
    });

    it("no se vincula con una parte de otra empresa", async () => {
      const otra = await c.escenario();
      const ajena = await persona({}, otra.operador);
      const mia = await persona();
      expect(
        await c.casos.vincularContacto(e.operador, {
          contactoId: mia,
          deParteId: ajena,
          tipo: "CONTACTO",
        }),
      ).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
    });

    it("dos vínculos cruzados a la vez no se traban entre sí (las partes se bloquean en orden de id)", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const a = await persona();
        const b = await persona();
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all([
            c.casos.vincularContacto(e.operador, { contactoId: a, deParteId: b, tipo: "CONTACTO" }),
            c.casos.vincularContacto(e.gerente, { contactoId: b, deParteId: a, tipo: "CONTACTO" }),
          ]);
          expect(resultados.every((r) => r.ok || codigoDe(r) === "ConcurrenciaAgotada")).toBe(true);
          expect(resultados.some((r) => r.ok)).toBe(true);
        } finally {
          c.soltarBarrera();
        }
      }
    });

    it("el operador puede vincular y desvincular (F1)", async () => {
      const contacto = await persona();
      const de = await empresa();
      const clave = { contactoId: contacto, deParteId: de, tipo: "CONTACTO" };
      expect(valorDe(await c.casos.vincularContacto(e.operador, clave))).toEqual({
        yaExistia: false,
      });
      expect(valorDe(await c.casos.desvincularContacto(e.operador, clave))).toEqual({
        yaEstaba: false,
      });
    });
  });

  // =============================================================================================
  describe("consultas", () => {
    it("buscarPartes: el documento idéntico primero, luego los nombres que empiezan y al final los que contienen", async () => {
      const otra = await c.escenario();
      const cuit = cuitAlAzar();
      const marca = nombreAlAzar("Zzquesos").replace(/\s.*/, "");
      const contiene = await empresa({ nombre: `La ${marca} del Sur`, documento: undefined });
      const empieza = await empresa({ nombre: `${marca} Argentinos SA`, documento: undefined });
      const idéntico = await empresa({
        nombre: "Otro nombre",
        documento: { tipo: "CUIT", numero: cuit },
      });
      await empresa({ nombre: `${marca} de la otra empresa` }, otra.operador);
      const r = valorDe(await c.consultas.buscarPartes(e.operador, { texto: marca }));
      expect(r.partes.map((p) => p.id)).toEqual([empieza, contiene]);
      const porDocumento = valorDe(await c.consultas.buscarPartes(e.operador, { texto: cuit }));
      expect(porDocumento.partes.map((p) => p.id)).toEqual([idéntico]);
      const conDocumentoYNombre = valorDe(
        await c.consultas.buscarPartes(e.operador, {
          texto: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`,
        }),
      );
      expect(conDocumentoYNombre.partes.map((p) => p.id)).toEqual([idéntico]);
    });

    it("buscarPartes: sin tildes ni mayúsculas, por rol, y las desactivadas solo si se piden", async () => {
      const marca = nombreAlAzar("Panadería").replace(/\s.*/, "");
      const proveedor = await empresa({ nombre: `${marca} Pérez`, roles: ["PROVEEDOR"] });
      const cliente = await empresa({ nombre: `${marca} Gómez`, roles: ["CUSTOMER"] });
      const buscar = async (entrada: Record<string, unknown>) =>
        valorDe(await c.consultas.buscarPartes(e.operador, entrada)).partes.map((p) => p.id);
      expect(await buscar({ texto: marca.toUpperCase().replace("Í", "I") })).toEqual(
        expect.arrayContaining([proveedor, cliente]),
      );
      expect(await buscar({ texto: marca, rol: "PROVEEDOR" })).toEqual([proveedor]);
      expect(await buscar({ texto: marca, rol: "CUSTOMER" })).toEqual([cliente]);
      expect(await buscar({ texto: marca, rol: "EMPLEADO" })).toEqual([]);
      valorDe(await c.casos.desactivarParte(e.gerente, { parteId: cliente }));
      expect(await buscar({ texto: marca })).toEqual([proveedor]);
      expect((await buscar({ texto: marca, incluirDesactivadas: true })).sort()).toEqual(
        [cliente, proveedor].sort(),
      );
    });

    it("buscarPartes: un texto con comodines de LIKE se busca tal cual; la paginación sigue por la última parte vista", async () => {
      const marca = nombreAlAzar("Pag").replace(/\s.*/, "");
      const ids: string[] = [];
      for (const sufijo of ["a", "b", "c"])
        ids.push(await empresa({ nombre: `${marca} ${sufijo}` }));
      const primera = valorDe(
        await c.consultas.buscarPartes(e.operador, { texto: marca, limite: 2 }),
      );
      expect(primera.partes).toHaveLength(2);
      expect(primera.siguiente).toBe(primera.partes[1]?.id);
      const segunda = valorDe(
        await c.consultas.buscarPartes(e.operador, {
          texto: marca,
          limite: 2,
          despuesDe: primera.siguiente as string,
        }),
      );
      expect(segunda.partes).toHaveLength(1);
      expect(segunda.siguiente).toBeNull();
      expect([...primera.partes, ...segunda.partes].map((p) => p.id)).toEqual(ids);
      expect(
        await c.consultas.buscarPartes(e.operador, { texto: marca, despuesDe: nuevoId() }),
      ).toEqual({
        ok: false,
        error: "CURSOR_INVALIDO",
      });
      for (const comodin of ["%", "_", "\\"]) {
        expect(
          valorDe(await c.consultas.buscarPartes(e.operador, { texto: `${marca}${comodin}` }))
            .partes,
        ).toEqual([]);
      }
    });

    it("fichaDeParte: la ficha con sus roles y vínculos; una parte de otra empresa es indistinguible de una inexistente", async () => {
      const de = await empresa({ nombre: nombreAlAzar("Ficha"), roles: ["PROVEEDOR", "CUSTOMER"] });
      const contacto = await persona({ nombre: nombreAlAzar("Contacto") });
      valorDe(
        await c.casos.vincularContacto(e.operador, {
          contactoId: contacto,
          deParteId: de,
          tipo: "CONTACTO",
          cargo: "Ventas",
        }),
      );
      const ficha = valorDe(await c.consultas.fichaDeParte(e.operador, { parteId: de }));
      expect(ficha).toMatchObject({
        id: de,
        version: 1,
        naturaleza: "JURIDICA",
        activa: true,
        roles: ["CUSTOMER", "PROVEEDOR"],
      });
      expect(ficha?.vinculos).toMatchObject([
        { contacto: { id: contacto }, deParte: { id: de }, tipo: "CONTACTO", cargo: "Ventas" },
      ]);
      const otra = await c.escenario();
      expect(valorDe(await c.consultas.fichaDeParte(otra.gerente, { parteId: de }))).toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeParte(e.operador, { parteId: nuevoId() })),
      ).toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeParte(e.operador, { parteId: "no-es-uuid" })),
      ).toBeNull();
    });

    it("posiblesDuplicados: avisa por email, teléfono o nombre; no bloquea y no mezcla empresas", async () => {
      const otra = await c.escenario();
      const email = `dup-${nuevoId()}@correo.com`;
      const igual = await persona({
        email,
        telefono: "+54 11 5555-1234",
        nombre: "Duplicado",
        apellido: "Único",
      });
      await persona({ email, nombre: "Ajena" }, otra.operador);
      const r = valorDe(
        await c.consultas.posiblesDuplicados(e.operador, {
          nombre: "duplicado",
          apellido: "unico",
          email,
          telefono: "541155551234",
        }),
      );
      expect(r.map((d) => [d.parteId, d.razones])).toEqual([
        [igual, ["EMAIL", "TELEFONO", "NOMBRE"]],
      ]);
      expect(
        valorDe(await c.consultas.posiblesDuplicados(e.operador, { nombre: nombreAlAzar("Nada") })),
      ).toEqual([]);
    });

    it("las consultas piden el permiso: sin rol en la empresa no se ve nada", async () => {
      const ajeno = { ...(await c.escenario()).operador, empresaId: e.empresaId };
      expect((await c.consultas.buscarPartes(ajeno, {})).ok).toBe(false);
      expect((await c.consultas.fichaDeParte(ajeno, { parteId: nuevoId() })).ok).toBe(false);
    });
  });

  // =============================================================================================
  describe("puertos para otros módulos", () => {
    it("parteParaOperacion: devuelve la parte activa con su rol, o el motivo por el que no sirve", async () => {
      const proveedor = await empresa({ roles: ["PROVEEDOR"] });
      const sinRol = await empresa({ roles: ["CUSTOMER"] });
      const apagada = await empresa({ roles: ["PROVEEDOR"] });
      valorDe(await c.casos.desactivarParte(e.gerente, { parteId: apagada }));
      const pedir = (id: string, contexto = e.operador) =>
        c.entorno.ejecutar({ contexto }, async (tx) =>
          c.directorio.parteParaOperacion(tx, contexto.empresaId, id, "PROVEEDOR"),
        );
      expect(valorDe(await pedir(proveedor))).toMatchObject({
        id: proveedor,
        roles: ["PROVEEDOR"],
        version: 1,
      });
      expect(await pedir(sinRol)).toEqual({ ok: false, error: "PARTE_SIN_ROL" });
      expect(await pedir(apagada)).toEqual({ ok: false, error: "PARTE_INACTIVA" });
      expect(await pedir(nuevoId())).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
      expect(await pedir("no-es-uuid")).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
      const otra = await c.escenario();
      expect(await pedir(proveedor, otra.operador)).toEqual({
        ok: false,
        error: "PARTE_NO_ENCONTRADA",
      });
    });

    it("crearEnTx: da de alta un proveedor en la transacción de quien llama, con el permiso compuesto y la misma repetición", async () => {
      const entrada = {
        idempotencia: nuevoId(),
        naturaleza: "JURIDICA",
        nombre: nombreAlAzar("Nuevo proveedor"),
        roles: ["PROVEEDOR"],
      };
      const crear = (contexto = e.operador) =>
        c.entorno.ejecutar({ contexto }, async (tx) =>
          c.registro.crearEnTx(tx, contexto, REGLAS_DE_EMPRESA, entrada as never),
        );
      const primera = valorDe(await crear());
      expect(primera.yaExistia).toBe(false);
      expect(valorDe(await crear())).toMatchObject({ parteId: primera.parteId, yaExistia: true });
      const ajeno = { ...(await c.escenario()).operador, empresaId: e.empresaId };
      expect((await crear(ajeno)).ok).toBe(false);
    });

    it("crearEnTx: si la transacción de quien llama se revierte, no queda ni la parte ni su auditoría", async () => {
      const entrada = {
        idempotencia: nuevoId(),
        naturaleza: "JURIDICA",
        nombre: nombreAlAzar("Se revierte"),
        roles: ["PROVEEDOR"],
      };
      const antes = await c.contar("select count(*) as n from parte where empresa_id = $1", [
        e.empresa,
      ]);
      const r = await c.entorno.ejecutar({ contexto: e.operador }, async (tx) => {
        const creada = await c.registro.crearEnTx(tx, e.operador, REGLAS_DE_EMPRESA, entrada);
        expect(creada.ok).toBe(true);
        return { ok: false as const, error: "FALLA_DE_QUIEN_LLAMA" as const };
      });
      expect(r).toEqual({ ok: false, error: "FALLA_DE_QUIEN_LLAMA" });
      expect(
        await c.contar("select count(*) as n from parte where empresa_id = $1", [e.empresa]),
      ).toBe(antes);
    });

    it("completarDocumentoEnTx: guarda el CUIT de la primera factura; repetirlo es yaEstaba; otro documento no se pisa; uno ocupado da el id", async () => {
      const sinDocumento = await empresa({ documento: undefined });
      const cuit = cuitAlAzar();
      const completar = (parteId: string, numero: string, version = 1, condicionIva?: string) =>
        c.entorno.ejecutar({ contexto: e.operador }, async (tx) =>
          c.registro.completarDocumentoEnTx(tx, e.operador, REGLAS_DE_EMPRESA, {
            parteId,
            documento: { tipo: "CUIT", numero },
            versionEsperada: version,
            ...(condicionIva === undefined ? {} : { condicionIva }),
          }),
        );
      expect(valorDe(await completar(sinDocumento, cuit, 1, "RESPONSABLE_INSCRIPTO"))).toEqual({
        version: 2,
        yaEstaba: false,
      });
      expect(
        await c.filas("select documento_normalizado, condicion_iva from parte where id = $1", [
          sinDocumento,
        ]),
      ).toEqual([{ documento_normalizado: `T${cuit}`, condicion_iva: "RESPONSABLE_INSCRIPTO" }]);
      expect(valorDe(await completar(sinDocumento, cuit, 1))).toEqual({
        version: 2,
        yaEstaba: true,
      });
      expect(await completar(sinDocumento, cuitAlAzar(), 2)).toEqual({
        ok: false,
        error: "PARTE_CON_OTRO_DOCUMENTO",
      });
      const otraSinDocumento = await empresa({ documento: undefined });
      expect(await completar(otraSinDocumento, cuit)).toEqual({
        ok: false,
        error: { error: "DOCUMENTO_YA_REGISTRADO", parteId: sinDocumento },
      });
      expect(await completar(otraSinDocumento, "123")).toMatchObject({ ok: false });
    });

    it("C6: dos primeras facturas del mismo proveedor sin CUIT, con CUIT distintos: uno guarda el suyo y el otro PARTE_CON_OTRO_DOCUMENTO", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const sinDocumento = await empresa({ documento: undefined });
        const cuits = [cuitAlAzar(), cuitAlAzar()];
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all(
            cuits.map((numero) =>
              c.entorno.ejecutar({ contexto: e.operador }, async (tx) =>
                c.registro.completarDocumentoEnTx(tx, e.operador, REGLAS_DE_EMPRESA, {
                  parteId: sinDocumento,
                  documento: { tipo: "CUIT", numero },
                  versionEsperada: 1,
                }),
              ),
            ),
          );
          const codigos = resultados.map((r) =>
            r.ok ? "ok" : typeof r.error === "string" ? r.error : codigoDe(r),
          );
          expect(codigos.filter((x) => x === "ok")).toHaveLength(1);
          expect(
            codigos.filter((x) =>
              [
                "PARTE_CON_OTRO_DOCUMENTO",
                "VERSION_DESACTUALIZADA",
                "ConcurrenciaAgotada",
              ].includes(x),
            ),
          ).toHaveLength(1);
        } finally {
          c.soltarBarrera();
        }
        expect(
          await c.contar(
            "select count(*) as n from parte where id = $1 and documento_normalizado is not null",
            [sinDocumento],
          ),
        ).toBe(1);
      }
    });
  });
});

import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";
import {
  montarClientes,
  nombreUnico,
  nuevoId,
  valorDe,
  RONDAS,
  type EscenarioDeClientes,
  type MontajeDeClientes,
} from "./clientes-apoyo";

/**
 * E9-T4: las partes del directorio (casos de uso) contra la base real y con las dependencias reales. Permisos por rol, validación por campo, documento
 * único (también entre desactivadas), avisos de duplicado que no bloquean, idempotencia (misma idempotencia = una parte; con otro contenido, error),
 * concurrencia (dos altas del mismo documento, dos ediciones a la vez), aislamiento entre empresas y auditoría SIN los datos personales (F2).
 * Rondas de concurrencia: `PEDERNAL_RONDAS` (3 por defecto).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("clientes: partes", () => {
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

  const alta = (extra: Record<string, unknown> = {}) => ({
    idempotencia: nuevoId(),
    naturaleza: "HUMANA",
    nombre: nombreUnico("Juan"),
    apellido: "Pérez",
    roles: ["CUSTOMER"],
    ...extra,
  });
  const crear = async (extra: Record<string, unknown> = {}, quien = e.operador) =>
    valorDe(await c.casos.crearParte(quien, alta(extra) as never));
  const parte = async (id: string) => (await c.filas("select * from parte where id = $1", [id]))[0];
  const contarPartes = (empresa = e.empresa) =>
    c.contar("select count(*) as n from parte where empresa_id = $1", [empresa]);
  const huboAuditoria = async (accion: string, entidadId: string) =>
    (await c.auditoria(e.empresa, accion)).filter((r) => r["entidad_id"] === entidadId);

  // =============================================================================================
  describe("crearParte", () => {
    it("el operador da de alta una persona y una empresa con sus roles; queda auditado SIN los datos personales", async () => {
      const nombre = nombreUnico("Marta");
      const salida = valorDe(
        await c.casos.crearParte(
          e.operador,
          alta({
            nombre,
            apellido: "Gómez",
            email: "marta@correo.com",
            telefono: "+54 11 7305-4821",
            documento: { tipo: "DNI", numero: "30.111.222" },
            roles: ["PROVEEDOR", "CUSTOMER"],
          }) as never,
        ),
      );
      expect(salida).toMatchObject({ yaExistia: false, posiblesDuplicados: [] });
      expect(await parte(salida.parteId)).toMatchObject({
        empresa_id: e.empresa,
        naturaleza: "HUMANA",
        nombre,
        apellido: "Gómez",
        documento_normalizado: "D30111222",
        estado: "ACTIVA",
        es_atajo: false,
        creado_por: e.personaDelOperador,
        version: 1,
      });
      expect(
        (
          await c.filas("select rol, activo from parte_rol where parte_id = $1 order by rol", [
            salida.parteId,
          ])
        ).map((r) => `${String(r["rol"])}:${String(r["activo"])}`),
      ).toEqual(["CUSTOMER:true", "PROVEEDOR:true"]);
      const registros = await huboAuditoria("PARTE_CREADA", salida.parteId);
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        actor_persona_id: e.personaDelOperador,
        entidad: "parte",
        despues: { naturaleza: "HUMANA", roles: ["CUSTOMER", "PROVEEDOR"], conDocumento: true },
      });
      // F2: ni el nombre, ni el documento, ni el email, ni el teléfono entran a la auditoría. Los valores a buscar son
      // largos (8 caracteres o más): un fragmento corto como «4321» aparece por azar dentro de los uuid del registro
      // (0,09 % de las corridas) y daba un falso positivo.
      const texto = JSON.stringify(registros[0]);
      for (const secreto of [
        nombre,
        "Gómez",
        "30111222",
        "30.111.222",
        "marta@correo.com",
        "73054821",
        "7305-4821",
      ]) {
        expect(texto).not.toContain(secreto);
      }
    });

    it("sin documento es un alta rápida (es_atajo); una empresa con CUIT; las tres entran con el rol de operador", async () => {
      const sinDocumento = await crear();
      expect((await parte(sinDocumento.parteId))?.["es_atajo"]).toBe(true);
      const empresa = valorDe(
        await c.casos.crearParte(e.operador, {
          idempotencia: nuevoId(),
          naturaleza: "JURIDICA",
          nombre: nombreUnico("Distribuidora"),
          documento: { tipo: "CUIT", numero: cuitUnico() },
          condicionIva: "RESPONSABLE_INSCRIPTO",
          roles: ["PROVEEDOR"],
        }),
      );
      expect(await parte(empresa.parteId)).toMatchObject({
        naturaleza: "JURIDICA",
        es_atajo: false,
      });
    });

    it("la validación es por campo y se informan todos juntos", async () => {
      const r = await c.casos.crearParte(
        e.operador,
        alta({
          nombre: "",
          email: "sin-arroba",
          telefono: "43\n21",
          documento: { tipo: "CUIT", numero: "1" },
        }),
      );
      expect(r).toEqual({
        ok: false,
        error: {
          error: "DATOS_INVALIDOS",
          campos: [
            { campo: "nombre", codigo: "NOMBRE_REQUERIDO" },
            { campo: "documento", codigo: "CUIT_INVALIDO" },
            { campo: "email", codigo: "EMAIL_INVALIDO" },
            { campo: "telefono", codigo: "TELEFONO_INVALIDO" },
          ],
        },
      });
    });

    it("R11: un pasaporte de 5 o 10, una empresa con DNI, un rol que no existe y una idempotencia que no es UUID", async () => {
      for (const numero of ["ABC12", "ABC1234567"]) {
        const r = await c.casos.crearParte(
          e.operador,
          alta({ documento: { tipo: "PASAPORTE", pais: "AR", numero } }),
        );
        expect(r.ok === false && JSON.stringify(r.error), numero).toContain("PASAPORTE_INVALIDO");
      }
      const empresaConDni = await c.casos.crearParte(
        e.operador,
        alta({
          naturaleza: "JURIDICA",
          apellido: undefined,
          documento: { tipo: "DNI", numero: "30111222" },
        }),
      );
      expect(JSON.stringify(empresaConDni)).toContain("DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA");
      expect(await c.casos.crearParte(e.operador, alta({ roles: ["EMPLEADO"] }) as never)).toEqual({
        ok: false,
        error: "ROL_DE_PARTE_INVALIDO",
      });
      expect(
        await c.casos.crearParte(e.operador, alta({ idempotencia: "no-es-uuid" }) as never),
      ).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
    });

    it("R11: el documento repetido se rechaza con el id de la parte que lo tiene, también si está desactivada", async () => {
      const documento = { tipo: "DNI", numero: "30333444" };
      const primera = await crear({ documento });
      expect(await c.casos.crearParte(e.operador, alta({ documento }) as never)).toEqual({
        ok: false,
        error: { error: "DOCUMENTO_YA_REGISTRADO", parteId: primera.parteId },
      });
      valorDe(await c.casos.desactivarParte(e.gerente, { parteId: primera.parteId }));
      expect(await c.casos.crearParte(e.operador, alta({ documento }) as never)).toEqual({
        ok: false,
        error: { error: "PARTE_INACTIVA_CON_ESE_DOCUMENTO", parteId: primera.parteId },
      });
      // Un CUIL con el número de un CUIT es el mismo documento.
      const cuit = cuitUnico();
      const conCuit = await crear({ documento: { tipo: "CUIL", numero: cuit } });
      expect(
        await c.casos.crearParte(
          e.operador,
          alta({ documento: { tipo: "CUIT", numero: cuit } }) as never,
        ),
      ).toEqual({
        ok: false,
        error: { error: "DOCUMENTO_YA_REGISTRADO", parteId: conCuit.parteId },
      });
    });

    it("C9: dos partes con el mismo email entran las dos y la segunda avisa el posible duplicado (no bloquea)", async () => {
      const email = `igual-${nuevoId()}@correo.com`;
      const primera = await crear({ email });
      const segunda = await crear({ email });
      expect(segunda.parteId).not.toBe(primera.parteId);
      expect(segunda.posiblesDuplicados.map((d) => [d.parteId, d.razones])).toEqual([
        [primera.parteId, ["EMAIL"]],
      ]);
    });

    it("I9: repetir crearParte con la misma idempotencia deja una parte y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
      const entrada = alta({ email: `i9-${nuevoId()}@correo.com` });
      const antes = await contarPartes();
      const primera = valorDe(await c.casos.crearParte(e.operador, entrada as never));
      const auditadas = (await c.auditoria(e.empresa, "PARTE_CREADA")).length;
      const otra = valorDe(await c.casos.crearParte(e.operador, entrada as never));
      expect(otra).toEqual({ parteId: primera.parteId, yaExistia: true, posiblesDuplicados: [] });
      expect(await contarPartes()).toBe(antes + 1);
      expect((await c.auditoria(e.empresa, "PARTE_CREADA")).length).toBe(auditadas);
      expect(
        await c.casos.crearParte(e.operador, { ...entrada, nombre: nombreUnico("Otro") }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect(await c.casos.crearParte(e.operador, { ...entrada, roles: ["PROVEEDOR"] })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
    });

    it("el mismo clic doble (dos pedidos iguales a la vez) deja una sola parte", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const entrada = alta({ documento: { tipo: "CUIT", numero: cuitUnico() } });
        const antes = await contarPartes();
        c.armarBarrera(2);
        try {
          const [a, b] = await Promise.all([
            c.casos.crearParte(e.operador, entrada as never),
            c.casos.crearParte(e.operador, entrada as never),
          ]);
          expect(
            [codigoDe(a), codigoDe(b)].every((x) => x === "ok" || x === "ConcurrenciaAgotada"),
          ).toBe(true);
          expect(a.ok || b.ok).toBe(true);
        } finally {
          c.soltarBarrera();
        }
        expect(await contarPartes()).toBe(antes + 1);
      }
    });

    it("C7: dos altas a la vez con el mismo documento: una parte y la otra DOCUMENTO_YA_REGISTRADO con el id de la ganadora", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const documento = { tipo: "CUIT", numero: cuitUnico() };
        c.armarBarrera(2);
        try {
          const [a, b] = await Promise.all([
            c.casos.crearParte(e.operador, alta({ documento }) as never),
            c.casos.crearParte(e.operador, alta({ documento }) as never),
          ]);
          const ganadora = [a, b].find((r) => r.ok);
          const perdedora = [a, b].find((r) => !r.ok);
          expect(ganadora, "alguien tiene que ganar").toBeDefined();
          if (ganadora?.ok && perdedora !== undefined && !perdedora.ok) {
            expect(perdedora.error).toEqual({
              error: "DOCUMENTO_YA_REGISTRADO",
              parteId: ganadora.valor.parteId,
            });
          }
        } finally {
          c.soltarBarrera();
        }
        expect(
          await c.contar(
            "select count(*) as n from parte where empresa_id = $1 and documento_normalizado = $2",
            [e.empresa, `T${documento.numero}`],
          ),
        ).toBe(1);
      }
    });

    it("R6: la misma idempotencia en dos empresas son dos partes; una empresa no ve ni toca las de la otra", async () => {
      const otra = await c.escenario();
      const idempotencia = nuevoId();
      const mia = valorDe(await c.casos.crearParte(e.operador, alta({ idempotencia }) as never));
      const suya = valorDe(
        await c.casos.crearParte(otra.operador, alta({ idempotencia }) as never),
      );
      expect(suya.parteId).not.toBe(mia.parteId);
      expect(suya.yaExistia).toBe(false);
      expect(
        await c.casos.editarParte(otra.gerente, {
          parteId: mia.parteId,
          versionEsperada: 1,
          cambios: { nota: "x" },
        }),
      ).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
      expect(await c.casos.desactivarParte(otra.gerente, { parteId: mia.parteId })).toEqual({
        ok: false,
        error: "PARTE_NO_ENCONTRADA",
      });
      expect((await parte(mia.parteId))?.["estado"]).toBe("ACTIVA");
    });
  });

  // =============================================================================================
  describe("editarParte", () => {
    it("el operador edita; sube la versión; la auditoría dice qué campos cambiaron y no sus valores", async () => {
      const creada = await crear({ email: `viejo-${nuevoId()}@correo.com` });
      const salida = valorDe(
        await c.casos.editarParte(e.operador, {
          parteId: creada.parteId,
          versionEsperada: 1,
          cambios: { telefono: "4321-5555", nota: "Paga a 30 días" },
        }),
      );
      expect(salida).toMatchObject({ version: 2, yaEstaba: false });
      expect(await parte(creada.parteId)).toMatchObject({
        telefono: "4321-5555",
        nota: "Paga a 30 días",
        version: 2,
      });
      const registros = await huboAuditoria("PARTE_EDITADA", creada.parteId);
      expect(registros).toHaveLength(1);
      expect(registros[0]?.["despues"]).toEqual({ campos: ["telefono", "nota"] });
    });

    it("lo que no viene no cambia; null borra un opcional; el documento se reemplaza entero", async () => {
      const creada = await crear({ nota: "Una nota", alias: "Juancho" });
      valorDe(
        await c.casos.editarParte(e.operador, {
          parteId: creada.parteId,
          versionEsperada: 1,
          cambios: { nota: null, documento: { tipo: "DNI", numero: "30555666" } },
        }),
      );
      expect(await parte(creada.parteId)).toMatchObject({
        nota: null,
        alias: "Juancho",
        documento_normalizado: "D30555666",
      });
    });

    it("I10: repetir editarParte ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const creada = await crear();
      const cambios = { nota: "Dato nuevo" };
      valorDe(
        await c.casos.editarParte(e.operador, {
          parteId: creada.parteId,
          versionEsperada: 1,
          cambios,
        }),
      );
      const auditadas = (await c.auditoria(e.empresa, "PARTE_EDITADA")).length;
      const otra = valorDe(
        await c.casos.editarParte(e.operador, {
          parteId: creada.parteId,
          versionEsperada: 1,
          cambios,
        }),
      );
      expect(otra).toEqual({ version: 2, yaEstaba: true, posiblesDuplicados: [] });
      expect((await parte(creada.parteId))?.["version"]).toBe(2);
      expect((await c.auditoria(e.empresa, "PARTE_EDITADA")).length).toBe(auditadas);
    });

    it("una versión vieja con un cambio real da VERSION_DESACTUALIZADA y no escribe", async () => {
      const creada = await crear();
      valorDe(
        await c.casos.editarParte(e.operador, {
          parteId: creada.parteId,
          versionEsperada: 1,
          cambios: { nota: "uno" },
        }),
      );
      expect(
        await c.casos.editarParte(e.operador, {
          parteId: creada.parteId,
          versionEsperada: 1,
          cambios: { nota: "dos" },
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect((await parte(creada.parteId))?.["nota"]).toBe("uno");
    });

    it("dos ediciones a la vez con la misma versión: una gana y la otra VERSION_DESACTUALIZADA", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const creada = await crear();
        c.armarBarrera(2);
        try {
          const [a, b] = await Promise.all([
            c.casos.editarParte(e.operador, {
              parteId: creada.parteId,
              versionEsperada: 1,
              cambios: { nota: "A" },
            }),
            c.casos.editarParte(e.gerente, {
              parteId: creada.parteId,
              versionEsperada: 1,
              cambios: { nota: "B" },
            }),
          ]);
          const codigos = [a, b].map((r) =>
            r.ok ? "ok" : codigoDe(r) === "otro" ? JSON.stringify(r.error) : codigoDe(r),
          );
          expect(codigos.filter((x) => x === "ok")).toHaveLength(1);
          expect(
            codigos.filter((x) => x === "VERSION_DESACTUALIZADA" || x === "ConcurrenciaAgotada"),
          ).toHaveLength(1);
        } finally {
          c.soltarBarrera();
        }
        expect((await parte(creada.parteId))?.["version"]).toBe(2);
      }
    });

    it("cambiar el documento a uno que es de otra parte da DOCUMENTO_YA_REGISTRADO con su id", async () => {
      const documento = { tipo: "DNI", numero: "30777888" };
      const dueña = await crear({ documento });
      const otra = await crear();
      expect(
        await c.casos.editarParte(e.operador, {
          parteId: otra.parteId,
          versionEsperada: 1,
          cambios: { documento },
        }),
      ).toEqual({ ok: false, error: { error: "DOCUMENTO_YA_REGISTRADO", parteId: dueña.parteId } });
    });

    it("datos inválidos y partes que no existen", async () => {
      const creada = await crear();
      expect(
        await c.casos.editarParte(e.operador, {
          parteId: creada.parteId,
          versionEsperada: 1,
          cambios: { email: "mal" },
        }),
      ).toEqual({
        ok: false,
        error: { error: "DATOS_INVALIDOS", campos: [{ campo: "email", codigo: "EMAIL_INVALIDO" }] },
      });
      for (const parteId of [nuevoId(), "no-es-uuid"]) {
        expect(
          await c.casos.editarParte(e.operador, {
            parteId,
            versionEsperada: 1,
            cambios: { nota: "x" },
          }),
        ).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
      }
    });
  });

  // =============================================================================================
  describe("desactivarParte y reactivarParte", () => {
    it("I11: desactivar y reactivar dos veces es ok y la segunda no escribe ni audita", async () => {
      const creada = await crear();
      expect(
        valorDe(await c.casos.desactivarParte(e.administrador, { parteId: creada.parteId })),
      ).toEqual({
        yaEstaba: false,
      });
      expect((await parte(creada.parteId))?.["estado"]).toBe("INACTIVA");
      const desactivaciones = (await c.auditoria(e.empresa, "PARTE_DESACTIVADA")).length;
      expect(
        valorDe(await c.casos.desactivarParte(e.administrador, { parteId: creada.parteId })),
      ).toEqual({
        yaEstaba: true,
      });
      expect((await c.auditoria(e.empresa, "PARTE_DESACTIVADA")).length).toBe(desactivaciones);
      expect(
        valorDe(await c.casos.reactivarParte(e.administrador, { parteId: creada.parteId })),
      ).toEqual({
        yaEstaba: false,
      });
      const reactivaciones = (await c.auditoria(e.empresa, "PARTE_REACTIVADA")).length;
      expect(
        valorDe(await c.casos.reactivarParte(e.administrador, { parteId: creada.parteId })),
      ).toEqual({
        yaEstaba: true,
      });
      expect((await c.auditoria(e.empresa, "PARTE_REACTIVADA")).length).toBe(reactivaciones);
      expect((await parte(creada.parteId))?.["estado"]).toBe("ACTIVA");
    });

    it("el operador no desactiva ni reactiva (F1): SIN_PERMISO y no cambia nada", async () => {
      const creada = await crear();
      expect(await c.casos.desactivarParte(e.operador, { parteId: creada.parteId })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      valorDe(await c.casos.desactivarParte(e.gerente, { parteId: creada.parteId }));
      expect(await c.casos.reactivarParte(e.operador, { parteId: creada.parteId })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect((await parte(creada.parteId))?.["estado"]).toBe("INACTIVA");
    });

    it("desactivar y reactivar a la vez no deja un estado a medias", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const creada = await crear();
        valorDe(await c.casos.desactivarParte(e.gerente, { parteId: creada.parteId }));
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all([
            c.casos.reactivarParte(e.gerente, { parteId: creada.parteId }),
            c.casos.reactivarParte(e.administrador, { parteId: creada.parteId }),
          ]);
          expect(resultados.filter((r) => r.ok && !r.valor.yaEstaba).length).toBeLessThanOrEqual(1);
          expect(resultados.some((r) => r.ok)).toBe(true);
        } finally {
          c.soltarBarrera();
        }
        expect((await parte(creada.parteId))?.["estado"]).toBe("ACTIVA");
      }
    });
  });

  describe("sin sesión de la empresa", () => {
    it("quien no es de la empresa no puede nada (denegar por defecto)", async () => {
      const otra = await c.escenario();
      const contextoAjeno = { ...otra.operador, empresaId: e.empresaId };
      const r = await c.casos.crearParte(contextoAjeno, alta());
      expect(r.ok).toBe(false);
    });
  });
});

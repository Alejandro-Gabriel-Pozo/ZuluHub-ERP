import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMembresiaDeBase, crearPersonaDeBase } from "../integracion/fixtures-identidad";
import { crearMundoDeMarca } from "../integracion/marcas-apoyo";
import { HOST_DEL_RECORRIDO, armarMundoDelRecorrido, type MundoDelRecorrido } from "./apoyo/mundo";
import { vigilar, violacionesGravesDeAxe, type Vigilante } from "./apoyo/vigilante";

/**
 * «Roles» de punta a punta en la app REAL construida, con un navegador real y una base real. El gerente entra a Cuenta → «Roles» y:
 *  R1 toca «Nuevo rol», escribe el nombre y toca «Guardar» dos veces seguidas: queda UN rol y va a su ficha;
 *  R2 en la ficha tilda una acción y guarda: queda guardada (una versión nueva) y al volver a abrir sigue tildada; lo cerrado (solo gerente) no se puede tildar;
 *  R3 archiva el rol: la lista lo muestra «Archivado»; lo reactiva y vuelve a figurar activo;
 *  R4 la ficha de un rol de otra empresa dice lo mismo que una inexistente.
 *  R5 abre la ficha de un empleado y le cambia el rol a uno propio con «Guardar» (dos toques seguidos: un solo cambio): queda guardado y la ficha lo muestra; el gerente no tiene ese bloque.
 *  R5 abre la ficha de un empleado y le cambia el rol a uno propio con «Guardar» (dos toques seguidos: un solo cambio): queda guardado y la ficha lo muestra; en la ficha del gerente no hay ese bloque.
 * Además: la entrada «Roles» figura en el menú de Cuenta para el gerente y sin violaciones graves de accesibilidad.
 * Lo que esta prueba ve y las de componentes y las de integración no: las acciones de servidor en el navegador (cifrado del id y de la versión ligados con `.bind`, la navegación tras crear) y la lista que se vuelve a leer.
 */
const base = inject("baseDePruebas");
const CELULAR = { width: 390, height: 844 } as const;
const GENERICO = "Esta acción no está permitida";

describe.skipIf(base === null)("recorrido de roles propios", () => {
  let mundo: MundoDelRecorrido;
  let navegador: Browser;
  let contexto: BrowserContext;
  let pagina: Page;
  let vigilante: Vigilante;
  let rolDeOtraEmpresa = "";

  const consulta = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[],
  ) => (await mundo.mundo.dueno.query<T>(texto, parametros)).rows;
  const rolesLlamados = (nombre: string) =>
    consulta<{ id: string; activo: boolean }>(
      "select id, activo from rol_de_empresa where empresa_id = $1 and nombre = $2",
      [mundo.empresa, nombre],
    );
  const accionesDe = async (rolId: string) =>
    (
      await consulta<{ acciones: string[] }>(
        "select acciones from version_de_rol where empresa_id = $1 and rol_id = $2 order by numero desc limit 1",
        [mundo.empresa, rolId],
      )
    )[0]?.acciones ?? [];
  const ir = async (ruta: string) => {
    const respuesta = await pagina.goto(`${mundo.url}${ruta}`);
    await pagina.waitForLoadState("networkidle");
    return respuesta;
  };
  const sinViolacionesDeAxe = async () => expect(await violacionesGravesDeAxe(pagina)).toEqual([]);

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoDelRecorrido(base);
    const c = mundo.mundo.dueno;
    // Otra empresa con un rol propio: su ficha no tiene que verse desde acá.
    const otra = await crearMundoDeMarca(c, { marca: mundo.mundo.marcaA });
    rolDeOtraEmpresa = "0c0c0c0c-1111-4222-8333-444444444441";
    await c.query(
      "insert into rol_de_empresa (id, empresa_id, nombre, nombre_clave) values ($1, $2, 'Ajeno', 'ajeno')",
      [rolDeOtraEmpresa, otra.empresa],
    );

    const ejecutable = process.env["PEDERNAL_NAVEGADOR"];
    navegador = await chromium.launch({
      ...(ejecutable === undefined || ejecutable === "" ? {} : { executablePath: ejecutable }),
      args: ["--no-proxy-server"],
    });
    contexto = await navegador.newContext({ ignoreHTTPSErrors: true, viewport: CELULAR });
    await contexto.addCookies([...mundo.cookies]);
    pagina = await contexto.newPage();
    vigilante = await vigilar(pagina, HOST_DEL_RECORRIDO);
  });
  afterAll(async () => {
    await navegador?.close();
    await mundo?.cerrar();
  });

  it("R1: «Nuevo rol», el nombre y dos toques seguidos en «Guardar» dejan UN rol y llevan a su ficha", async () => {
    await ir("/cuenta/roles");
    await pagina.getByRole("heading", { name: "Roles" }).waitFor();
    await sinViolacionesDeAxe();
    await pagina.getByRole("link", { name: "Nuevo rol" }).click();
    await pagina.waitForURL(/\/cuenta\/roles\/nuevo$/);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByLabel("Nombre").fill("Cajero");
    await sinViolacionesDeAxe();

    await pagina.getByRole("button", { name: "Guardar" }).dblclick();
    await pagina.waitForURL(/\/cuenta\/roles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await pagina.waitForLoadState("networkidle");

    expect(await rolesLlamados("Cajero")).toHaveLength(1);
    await pagina.getByRole("heading", { name: "Cajero" }).waitFor();
    expect(vigilante.tomar()).toEqual([]);
  });

  it("R2: en la ficha tilda una acción y guarda: queda guardada y al volver a abrir sigue tildada; lo de «solo el gerente» no se puede tildar", async () => {
    const [rol] = await rolesLlamados("Cajero");
    await ir(`/cuenta/roles/${rol?.id}`);
    await pagina.getByText("Qué puede hacer").waitFor();
    await expect(
      pagina.getByRole("checkbox", { name: /Ver los roles/ }).isDisabled(),
    ).resolves.toBe(true);
    await pagina.getByRole("checkbox", { name: /Invitar usuarios/ }).check();
    await sinViolacionesDeAxe();
    await pagina.getByRole("button", { name: "Guardar" }).click();
    await expect
      .poll(async () => (await accionesDe(rol?.id ?? "")).includes("usuarios.invitar"))
      .toBe(true);

    await ir(`/cuenta/roles/${rol?.id}`);
    await expect(
      pagina.getByRole("checkbox", { name: /Invitar usuarios/ }).isChecked(),
    ).resolves.toBe(true);
  });

  it("R3: archivar lo muestra «Archivado» en la lista y reactivar lo vuelve a dejar activo", async () => {
    const [rol] = await rolesLlamados("Cajero");
    await ir(`/cuenta/roles/${rol?.id}`);
    await pagina.getByRole("button", { name: "Archivar" }).click();
    await expect.poll(async () => (await rolesLlamados("Cajero"))[0]?.activo).toBe(false);
    await ir("/cuenta/roles");
    await pagina
      .getByRole("link", { name: /Cajero/ })
      .getByText("Archivado")
      .waitFor();

    await ir(`/cuenta/roles/${rol?.id}`);
    await pagina.getByRole("button", { name: "Reactivar" }).click();
    await expect.poll(async () => (await rolesLlamados("Cajero"))[0]?.activo).toBe(true);
  });

  it("R4: la ficha de un rol de otra empresa dice lo mismo que una inexistente, sin el nombre", async () => {
    await ir(`/cuenta/roles/${rolDeOtraEmpresa}`);
    await pagina.getByText(GENERICO).waitFor();
    expect(await pagina.content()).not.toContain("Ajeno");
    await ir("/cuenta/roles/0c0c0c0c-1111-4222-8333-444444444499");
    await pagina.getByText(GENERICO).waitFor();
  });

  it("R5: en la ficha de un empleado el gerente cambia su rol a uno propio con «Guardar» (dos toques, un solo cambio) y queda guardado; la ficha del gerente no ofrece cambiar el rol", async () => {
    const c = mundo.mundo.dueno;
    const persona = await crearPersonaDeBase(c, "empleado@lacteos.test");
    await crearMembresiaDeBase(c, mundo.empresa, persona.id, "OPERADOR");
    const [cajero] = await rolesLlamados("Cajero");
    await ir(`/cuenta/usuarios/${persona.id}`);
    const selector = pagina.getByLabel("Rol", { exact: true });
    await selector.waitFor();
    await sinViolacionesDeAxe();
    await selector.selectOption(`PROPIO:${cajero?.id}`);
    await pagina.getByRole("button", { name: "Guardar" }).first().dblclick();
    await expect
      .poll(
        async () =>
          (
            await consulta<{ rol: string; rol_propio_id: string | null }>(
              "select rol, rol_propio_id from membresia where empresa_id = $1 and persona_id = $2",
              [mundo.empresa, persona.id],
            )
          )[0],
      )
      .toEqual({ rol: "PROPIO", rol_propio_id: cajero?.id });
    const asignaciones = await consulta<{ n: string }>(
      "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'ROL_ASIGNADO' and entidad_id = $2",
      [mundo.empresa, persona.id],
    );
    expect(Number(asignaciones[0]?.n)).toBe(1);

    await ir(`/cuenta/usuarios/${persona.id}`);
    await pagina.getByText("Cajero").first().waitFor();
    const gerente = await consulta<{ persona_id: string }>(
      "select persona_id from membresia where empresa_id = $1 and rol = 'GERENTE'",
      [mundo.empresa],
    );
    await ir(`/cuenta/usuarios/${gerente[0]?.persona_id}`);
    await pagina.getByRole("heading").first().waitFor();
    expect(await pagina.getByLabel("Rol", { exact: true }).count()).toBe(0);
  });

  it("la entrada «Roles» figura en el menú de Cuenta del gerente", async () => {
    await ir("/cuenta");
    await pagina.getByRole("link", { name: "Roles" }).first().waitFor();
  });
});

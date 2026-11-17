/**
 * Los textos del módulo `clientes` (prefijo `clientes.`, E9-T15; `e9-compras-especificacion.md` §10). Ninguno es nuevo: todos salen de los que el
 * dueño aprobó el 09/11/2026 en el prototipo `directorio.html`, sección «Textos nuevos» (repositorio de documentos,
 * `10-ux-ui/prototipos-gastronomia/directorio.html`). Los rótulos del formulario («Nombre», «Apellido», «Email», «Teléfono»,
 * «Domicilio», etc.) no figuran en la lista de `e9-compras-especificacion.md` §10 y no se agregan acá (decisión D175).
 */
export const TEXTOS_DE_CLIENTES = {
  // directorio.html, «Textos nuevos» (09/11/2026), fila «Lista y ficha»
  "clientes.lista.clientes_y_proveedores": { porDefecto: "Clientes y proveedores" },
  "clientes.lista.persona": { porDefecto: "Persona" },
  "clientes.lista.empresa": { porDefecto: "Empresa" },
  "clientes.lista.razon_social": { porDefecto: "Razón social" },
  "clientes.lista.documento": { porDefecto: "Documento" },
  "clientes.lista.condicion_frente_al_iva": { porDefecto: "Condición frente al IVA" },
  "clientes.lista.posibles_duplicados": { porDefecto: "Posibles duplicados" },
  "clientes.lista.guardar_igual": { porDefecto: "Guardar igual" },
  "clientes.lista.contactos": { porDefecto: "Contactos" },
  "clientes.lista.agregar_contacto": { porDefecto: "Agregar contacto" },
  "clientes.lista.cargo": { porDefecto: "Cargo" },
  "clientes.lista.desactivar": { porDefecto: "Desactivar" },
  "clientes.lista.reactivar": { porDefecto: "Reactivar" },
  "clientes.lista.mostrar_desactivados": { porDefecto: "Mostrar desactivados" },

  // directorio.html, «Textos nuevos», fila «Errores»; los códigos DOCUMENTO_YA_REGISTRADO y PARTE_INACTIVA_CON_ESE_DOCUMENTO son de E9 §3.1
  "clientes.error.cuit_invalido": { porDefecto: "El CUIT no es válido" },
  "clientes.error.documento_ya_registrado": {
    porDefecto: "Ya existe una persona o empresa con ese documento",
  },
  "clientes.error.parte_inactiva_con_ese_documento": {
    porDefecto: "Ya existe, pero está desactivada",
  },
  "clientes.error.falta_el_nombre": { porDefecto: "Falta el nombre" },
  "clientes.error.email_invalido": { porDefecto: "El email no es válido" },
  "clientes.error.telefono_invalido": { porDefecto: "El teléfono no es válido" },
} as const;

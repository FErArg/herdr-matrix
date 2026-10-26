// Salas por workspace de Herdr (Fase 2b). Cada workspace activo tiene una sala cifrada y privada.
// La reconciliación compara los workspaces activos con `rooms[]` de config.json:
//   - workspace sin sala activa → crear sala, invitar al dueño y guardar el mapeo;
//   - etiqueta cambiada → renombrar la sala;
//   - sala activa cuyo workspace ya no existe → archivar (aviso final y solo lectura; no se borra).
// Una sala archivada deja de enrutar: outbound descarta los eventos de ese workspace.

export const ROOM_STATE_TYPE = "dev.herdr.workspace";
export const ARCHIVED_NOTICE = "Workspace cerrado en Herdr. Sala archivada: ya no admite mensajes.";
const READ_ONLY_EVENTS_DEFAULT = 100;

// onCreated({ label, roomId }): se llama tras crear una sala (p. ej., para preguntar por invitados).
// Un fallo en onCreated no revierte la sala creada.
export function createRoomManager({ matrix, sendText, config, saveConfig, log, onCreated = null }) {
  const rooms = () => {
    config.rooms ??= [];
    return config.rooms;
  };

  const activeEntry = (workspaceId) =>
    rooms().find((room) => room.workspace_id === workspaceId && room.status === "active");

  async function create(workspace) {
    const roomId = await matrix.createEncryptedRoom({ name: workspace.label, invite: [config.owner] });
    // El mapeo se guarda antes de los eventos de estado: si fallan, la siguiente reconciliación no crea una sala duplicada.
    rooms().push({
      workspace_id: workspace.workspace_id,
      label: workspace.label,
      room_id: roomId,
      status: "active",
    });
    await saveConfig(config);
    await matrix.putState(roomId, ROOM_STATE_TYPE, { workspace_id: workspace.workspace_id });
    log(`sala creada para el workspace ${workspace.label}`);
    await onCreated?.({ label: workspace.label, roomId });
  }

  async function rename(entry, label) {
    await matrix.putState(entry.room_id, "m.room.name", { name: label });
    entry.label = label;
    await saveConfig(config);
    log(`sala renombrada a ${label}`);
  }

  // Primero se pasa a solo lectura y después se avisa: el aviso es el último mensaje que la sala admite.
  async function archive(entry) {
    const levels = await matrix.getState(entry.room_id, "m.room.power_levels");
    if (!levels) throw new Error("la sala no tiene m.room.power_levels");
    await matrix.putState(entry.room_id, "m.room.power_levels", { ...levels, events_default: READ_ONLY_EVENTS_DEFAULT });
    await sendText(entry.room_id, ARCHIVED_NOTICE);
    entry.status = "archived";
    entry.archived_at = new Date().toISOString();
    await saveConfig(config);
    log(`sala archivada: ${entry.label}`);
  }

  // Un fallo en un workspace no detiene los demás; se registra y se reintenta en la siguiente reconciliación.
  async function attempt(description, action) {
    try {
      await action();
    } catch (error) {
      log(`${description} fallido: ${error.message}`);
    }
  }

  // workspaces: [{ workspace_id, label }] de workspace.list (solo los activos).
  async function sync(workspaces) {
    const activeIds = new Set(workspaces.map((workspace) => workspace.workspace_id));

    for (const workspace of workspaces) {
      const entry = activeEntry(workspace.workspace_id);
      if (!entry) {
        await attempt(`crear sala de ${workspace.label}`, () => create(workspace));
      } else if (entry.label !== workspace.label) {
        await attempt(`renombrar sala de ${workspace.label}`, () => rename(entry, workspace.label));
      }
    }

    for (const entry of rooms().filter((room) => room.status === "active" && !activeIds.has(room.workspace_id))) {
      await attempt(`archivar sala de ${entry.label}`, () => archive(entry));
    }
  }

  return { sync };
}

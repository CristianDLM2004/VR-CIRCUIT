export class AppState {

    constructor() {
        this.components = []   // lista de componentes
        this.connections = []  // lista de conexiones
    }

    addComponent(componentData) {
        this.components.push(componentData)
    }

    updateComponent(id, newData) {
        const index = this.components.findIndex(c => c.id === id)
        if (index !== -1) {
            this.components[index] = {
                ...this.components[index],
                ...newData
            }
        }
    }

    removeComponent(id) {
        this.components = this.components.filter(c => c.id !== id)
        this.connections = this.connections.filter(conn =>
            conn.from !== id && conn.to !== id
        )
    }

    getState() {
        return {
            components: this.components,
            connections: this.connections
        }
    }

    toJSON() {
        return JSON.stringify(this.getState(), null, 2)
    }

    loadFromObject(obj) {
        this.components = Array.isArray(obj?.components) ? obj.components : []
        this.connections = Array.isArray(obj?.connections) ? obj.connections : []
    }
}
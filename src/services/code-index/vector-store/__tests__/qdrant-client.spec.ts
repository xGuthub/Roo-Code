import { QdrantClient } from "@qdrant/js-client-rest"
import { createHash } from "crypto"

import { QdrantVectorStore } from "../qdrant-client"
import { getWorkspacePath } from "../../../../utils/path"
import { DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_MIN_SCORE } from "../../constants"

// Mocks
vitest.mock("@qdrant/js-client-rest")
vitest.mock("crypto")
vitest.mock("../../../../utils/path")
vitest.mock("../../../../i18n", () => ({
	t: (key: string, params?: any) => {
		// Mock translation function that includes parameters for testing
		if (key === "embeddings:vectorStore.vectorDimensionMismatch" && params?.errorMessage) {
			return `Failed to update vector index for new model. Please try clearing the index and starting again. Details: ${params.errorMessage}`
		}
		if (key === "embeddings:vectorStore.qdrantConnectionFailed" && params?.qdrantUrl && params?.errorMessage) {
			return `Failed to connect to Qdrant vector database. Please ensure Qdrant is running and accessible at ${params.qdrantUrl}. Error: ${params.errorMessage}`
		}
		return key // Just return the key for other cases
	},
}))
vitest.mock("path", () => ({
	...vitest.importActual("path"),
	sep: "/",
}))

const mockQdrantClientInstance = {
	getCollection: vitest.fn(),
	createCollection: vitest.fn(),
	deleteCollection: vitest.fn(),
	createPayloadIndex: vitest.fn(),
	upsert: vitest.fn(),
	query: vitest.fn(),
	delete: vitest.fn(),
}

const mockCreateHashInstance = {
	update: vitest.fn().mockReturnThis(),
	digest: vitest.fn(),
}

describe("QdrantVectorStore", () => {
	let vectorStore: QdrantVectorStore
	const mockWorkspacePath = "/test/workspace"
	const mockQdrantUrl = "http://mock-qdrant:6333"
	const mockApiKey = "test-api-key"
	const mockVectorSize = 1536
	const mockHashedPath = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" // Needs to be long enough
	const expectedCollectionName = `ws-${mockHashedPath.substring(0, 16)}`

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock QdrantClient constructor
		;(QdrantClient as any).mockImplementation(() => mockQdrantClientInstance)

		// Mock crypto.createHash
		;(createHash as any).mockReturnValue(mockCreateHashInstance)
		mockCreateHashInstance.update.mockReturnValue(mockCreateHashInstance) // Ensure it returns 'this'
		mockCreateHashInstance.digest.mockReturnValue(mockHashedPath)

		// Mock getWorkspacePath
		;(getWorkspacePath as any).mockReturnValue(mockWorkspacePath)

		vectorStore = new QdrantVectorStore(mockWorkspacePath, mockQdrantUrl, mockVectorSize, mockApiKey)
	})

	it("should correctly initialize QdrantClient and collectionName in constructor", () => {
		expect(QdrantClient).toHaveBeenCalledTimes(1)
		expect(QdrantClient).toHaveBeenCalledWith({
			host: "mock-qdrant",
			https: false,
			port: 6333,
			apiKey: mockApiKey,
			headers: {
				"User-Agent": "Roo-Code",
			},
		})
		expect(createHash).toHaveBeenCalledWith("sha256")
		expect(mockCreateHashInstance.update).toHaveBeenCalledWith(mockWorkspacePath)
		expect(mockCreateHashInstance.digest).toHaveBeenCalledWith("hex")
		// Access private member for testing constructor logic (not ideal, but necessary here)
		expect((vectorStore as any).collectionName).toBe(expectedCollectionName)
		expect((vectorStore as any).vectorSize).toBe(mockVectorSize)
	})
	it("should handle constructor with default URL when none provided", () => {
		const vectorStoreWithDefaults = new QdrantVectorStore(mockWorkspacePath, undefined as any, mockVectorSize)

		expect(QdrantClient).toHaveBeenLastCalledWith({
			host: "localhost",
			https: false,
			port: 6333,
			apiKey: undefined,
			headers: {
				"User-Agent": "Roo-Code",
			},
		})
	})

	it("should handle constructor without API key", () => {
		const vectorStoreWithoutKey = new QdrantVectorStore(mockWorkspacePath, mockQdrantUrl, mockVectorSize)

		expect(QdrantClient).toHaveBeenLastCalledWith({
			host: "mock-qdrant",
			https: false,
			port: 6333,
			apiKey: undefined,
			headers: {
				"User-Agent": "Roo-Code",
			},
		})
	})

	describe("URL Parsing and Explicit Port Handling", () => {
		describe("HTTPS URL handling", () => {
			it("should use explicit port 443 for HTTPS URLs without port (fixes the main bug)", () => {
				const vectorStore = new QdrantVectorStore(
					mockWorkspacePath,
					"https://qdrant.ashbyfam.com",
					mockVectorSize,
				)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "qdrant.ashbyfam.com",
					https: true,
					port: 443,
					prefix: undefined, // No prefix for root path
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("https://qdrant.ashbyfam.com")
			})

			it("should use explicit port for HTTPS URLs with explicit port", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "https://example.com:9000", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "example.com",
					https: true,
					port: 9000,
					prefix: undefined, // No prefix for root path
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("https://example.com:9000")
			})

			it("should use port 443 for HTTPS URLs with paths and query parameters", () => {
				const vectorStore = new QdrantVectorStore(
					mockWorkspacePath,
					"https://example.com/api/v1?key=value",
					mockVectorSize,
				)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "example.com",
					https: true,
					port: 443,
					prefix: "/api/v1", // Should have prefix
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("https://example.com/api/v1?key=value")
			})
		})

		describe("HTTP URL handling", () => {
			it("should use explicit port 80 for HTTP URLs without port", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "http://example.com", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "example.com",
					https: false,
					port: 80,
					prefix: undefined, // No prefix for root path
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://example.com")
			})

			it("should use explicit port for HTTP URLs with explicit port", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "http://localhost:8080", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "localhost",
					https: false,
					port: 8080,
					prefix: undefined, // No prefix for root path
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://localhost:8080")
			})

			it("should use port 80 for HTTP URLs while preserving paths and query parameters", () => {
				const vectorStore = new QdrantVectorStore(
					mockWorkspacePath,
					"http://example.com/api/v1?key=value",
					mockVectorSize,
				)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "example.com",
					https: false,
					port: 80,
					prefix: "/api/v1", // Should have prefix
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://example.com/api/v1?key=value")
			})
		})

		describe("Hostname handling", () => {
			it("should convert hostname to http with port 80", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "qdrant.example.com", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "qdrant.example.com",
					https: false,
					port: 80,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://qdrant.example.com")
			})

			it("should handle hostname:port format with explicit port", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "localhost:6333", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "localhost",
					https: false,
					port: 6333,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
			})

			it("should handle explicit HTTP URLs correctly", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "http://localhost:9000", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "localhost",
					https: false,
					port: 9000,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://localhost:9000")
			})
		})

		describe("IP address handling", () => {
			it("should convert IP address to http with port 80", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "192.168.1.100", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "192.168.1.100",
					https: false,
					port: 80,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://192.168.1.100")
			})

			it("should handle IP:port format with explicit port", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "192.168.1.100:6333", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "192.168.1.100",
					https: false,
					port: 6333,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://192.168.1.100:6333")
			})
		})

		describe("Edge cases", () => {
			it("should handle undefined URL with host-based config", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, undefined as any, mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "localhost",
					https: false,
					port: 6333,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
			})

			it("should handle empty string URL with host-based config", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "localhost",
					https: false,
					port: 6333,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
			})

			it("should handle whitespace-only URL with host-based config", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "   ", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "localhost",
					https: false,
					port: 6333,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://localhost:6333")
			})
		})

		describe("Invalid URL fallback", () => {
			it("should treat invalid URLs as hostnames with port 80", () => {
				const vectorStore = new QdrantVectorStore(mockWorkspacePath, "invalid-url-format", mockVectorSize)
				expect(QdrantClient).toHaveBeenLastCalledWith({
					host: "invalid-url-format",
					https: false,
					port: 80,
					apiKey: undefined,
					headers: {
						"User-Agent": "Roo-Code",
					},
				})
				expect((vectorStore as any).qdrantUrl).toBe("http://invalid-url-format")
			})
		})
	})

	describe("URL Prefix Handling", () => {
		it("should pass the URL pathname as prefix to QdrantClient if not root", () => {
			const vectorStoreWithPrefix = new QdrantVectorStore(
				mockWorkspacePath,
				"http://localhost:6333/some/path",
				mockVectorSize,
			)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "localhost",
				https: false,
				port: 6333,
				prefix: "/some/path",
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreWithPrefix as any).qdrantUrl).toBe("http://localhost:6333/some/path")
		})

		it("should not pass prefix if the URL pathname is root ('/')", () => {
			const vectorStoreWithoutPrefix = new QdrantVectorStore(
				mockWorkspacePath,
				"http://localhost:6333/",
				mockVectorSize,
			)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "localhost",
				https: false,
				port: 6333,
				prefix: undefined,
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreWithoutPrefix as any).qdrantUrl).toBe("http://localhost:6333/")
		})

		it("should handle HTTPS URL with path as prefix", () => {
			const vectorStoreWithHttpsPrefix = new QdrantVectorStore(
				mockWorkspacePath,
				"https://qdrant.ashbyfam.com/api",
				mockVectorSize,
			)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "qdrant.ashbyfam.com",
				https: true,
				port: 443,
				prefix: "/api",
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreWithHttpsPrefix as any).qdrantUrl).toBe("https://qdrant.ashbyfam.com/api")
		})

		it("should normalize URL pathname by removing trailing slash for prefix", () => {
			const vectorStoreWithTrailingSlash = new QdrantVectorStore(
				mockWorkspacePath,
				"http://localhost:6333/api/",
				mockVectorSize,
			)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "localhost",
				https: false,
				port: 6333,
				prefix: "/api", // Trailing slash should be removed
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreWithTrailingSlash as any).qdrantUrl).toBe("http://localhost:6333/api/")
		})

		it("should normalize URL pathname by removing multiple trailing slashes for prefix", () => {
			const vectorStoreWithMultipleTrailingSlashes = new QdrantVectorStore(
				mockWorkspacePath,
				"http://localhost:6333/api///",
				mockVectorSize,
			)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "localhost",
				https: false,
				port: 6333,
				prefix: "/api", // All trailing slashes should be removed
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreWithMultipleTrailingSlashes as any).qdrantUrl).toBe("http://localhost:6333/api///")
		})

		it("should handle multiple path segments correctly for prefix", () => {
			const vectorStoreWithMultiSegment = new QdrantVectorStore(
				mockWorkspacePath,
				"http://localhost:6333/api/v1/qdrant",
				mockVectorSize,
			)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "localhost",
				https: false,
				port: 6333,
				prefix: "/api/v1/qdrant",
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreWithMultiSegment as any).qdrantUrl).toBe("http://localhost:6333/api/v1/qdrant")
		})

		it("should handle complex URL with multiple segments, multiple trailing slashes, query params, and fragment", () => {
			const complexUrl = "https://example.com/ollama/api/v1///?key=value#pos"
			const vectorStoreComplex = new QdrantVectorStore(mockWorkspacePath, complexUrl, mockVectorSize)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "example.com",
				https: true,
				port: 443,
				prefix: "/ollama/api/v1", // Trailing slash removed, query/fragment ignored
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreComplex as any).qdrantUrl).toBe(complexUrl)
		})

		it("should ignore query parameters and fragments when determining prefix", () => {
			const vectorStoreWithQueryParams = new QdrantVectorStore(
				mockWorkspacePath,
				"http://localhost:6333/api/path?key=value#fragment",
				mockVectorSize,
			)
			expect(QdrantClient).toHaveBeenLastCalledWith({
				host: "localhost",
				https: false,
				port: 6333,
				prefix: "/api/path", // Query params and fragment should be ignored
				apiKey: undefined,
				headers: {
					"User-Agent": "Roo-Code",
				},
			})
			expect((vectorStoreWithQueryParams as any).qdrantUrl).toBe(
				"http://localhost:6333/api/path?key=value#fragment",
			)
		})
	})

	describe("initialize", () => {
		it("should create a new collection if none exists and return true", async () => {
			// Mock getCollection to throw a 404-like error
			mockQdrantClientInstance.getCollection.mockRejectedValue({
				response: { status: 404 },
				message: "Not found",
			})
			mockQdrantClientInstance.createCollection.mockResolvedValue(true as any) // Cast to any to satisfy QdrantClient types if strict
			mockQdrantClientInstance.createPayloadIndex.mockResolvedValue({} as any) // Mock successful index creation

			const result = await vectorStore.initialize()

			expect(result).toBe(true)
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledWith(expectedCollectionName)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledWith(expectedCollectionName, {
				vectors: {
					size: mockVectorSize,
					distance: "Cosine", // Assuming 'Cosine' is the DISTANCE_METRIC
				},
			})
			expect(mockQdrantClientInstance.deleteCollection).not.toHaveBeenCalled()

			// Verify payload index creation
			for (let i = 0; i <= 4; i++) {
				expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
					field_name: `pathSegments.${i}`,
					field_schema: "keyword",
				})
			}
			expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledTimes(5)
		})
		it("should not create a new collection if one exists with matching vectorSize and return false", async () => {
			// Mock getCollection to return existing collection info with matching vector size
			mockQdrantClientInstance.getCollection.mockResolvedValue({
				config: {
					params: {
						vectors: {
							size: mockVectorSize, // Matching vector size
						},
					},
				},
			} as any) // Cast to any to satisfy QdrantClient types
			mockQdrantClientInstance.createPayloadIndex.mockResolvedValue({} as any)

			const result = await vectorStore.initialize()

			expect(result).toBe(false)
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledWith(expectedCollectionName)
			expect(mockQdrantClientInstance.createCollection).not.toHaveBeenCalled()
			expect(mockQdrantClientInstance.deleteCollection).not.toHaveBeenCalled()

			// Verify payload index creation still happens
			for (let i = 0; i <= 4; i++) {
				expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
					field_name: `pathSegments.${i}`,
					field_schema: "keyword",
				})
			}
			expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledTimes(5)
		})
		it("should recreate collection if it exists but vectorSize mismatches and return true", async () => {
			const differentVectorSize = 768
			// Mock getCollection to return existing collection info with different vector size first,
			// then return 404 to confirm deletion
			mockQdrantClientInstance.getCollection
				.mockResolvedValueOnce({
					config: {
						params: {
							vectors: {
								size: differentVectorSize, // Mismatching vector size
							},
						},
					},
				} as any)
				.mockRejectedValueOnce({
					response: { status: 404 },
					message: "Not found",
				})
			mockQdrantClientInstance.deleteCollection.mockResolvedValue(true as any)
			mockQdrantClientInstance.createCollection.mockResolvedValue(true as any)
			mockQdrantClientInstance.createPayloadIndex.mockResolvedValue({} as any)
			vitest.spyOn(console, "warn").mockImplementation(() => {}) // Suppress console.warn

			const result = await vectorStore.initialize()

			expect(result).toBe(true)
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(2) // Once to check, once to verify deletion
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledWith(expectedCollectionName)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledWith(expectedCollectionName)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledWith(expectedCollectionName, {
				vectors: {
					size: mockVectorSize, // Should use the new, correct vector size
					distance: "Cosine",
				},
			})

			// Verify payload index creation
			for (let i = 0; i <= 4; i++) {
				expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledWith(expectedCollectionName, {
					field_name: `pathSegments.${i}`,
					field_schema: "keyword",
				})
			}
			expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledTimes(5)
			;(console.warn as any).mockRestore() // Restore console.warn
		})
		it("should log warning for non-404 errors but still create collection", async () => {
			const genericError = new Error("Generic Qdrant Error")
			mockQdrantClientInstance.getCollection.mockRejectedValue(genericError)
			vitest.spyOn(console, "warn").mockImplementation(() => {}) // Suppress console.warn

			const result = await vectorStore.initialize()

			expect(result).toBe(true) // Collection was created
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).not.toHaveBeenCalled()
			expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledTimes(5)
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining(`Warning during getCollectionInfo for "${expectedCollectionName}"`),
				genericError.message,
			)
			;(console.warn as any).mockRestore()
		})
		it("should re-throw error from createCollection when no collection initially exists", async () => {
			mockQdrantClientInstance.getCollection.mockRejectedValue({
				response: { status: 404 },
				message: "Not found",
			})
			const createError = new Error("Create Collection Failed")
			mockQdrantClientInstance.createCollection.mockRejectedValue(createError)
			vitest.spyOn(console, "error").mockImplementation(() => {}) // Suppress console.error

			// The actual error message includes the URL and error details
			await expect(vectorStore.initialize()).rejects.toThrow(
				/Failed to connect to Qdrant vector database|vectorStore\.qdrantConnectionFailed/,
			)

			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).not.toHaveBeenCalled()
			expect(mockQdrantClientInstance.createPayloadIndex).not.toHaveBeenCalled() // Should not be called if createCollection fails
			expect(console.error).toHaveBeenCalledTimes(1) // Only the outer try/catch
			;(console.error as any).mockRestore()
		})
		it("should log but not fail if payload index creation errors occur", async () => {
			// Mock successful collection creation
			mockQdrantClientInstance.getCollection.mockRejectedValue({
				response: { status: 404 },
				message: "Not found",
			})
			mockQdrantClientInstance.createCollection.mockResolvedValue(true as any)

			// Mock payload index creation to fail
			const indexError = new Error("Index creation failed")
			mockQdrantClientInstance.createPayloadIndex.mockRejectedValue(indexError)
			vitest.spyOn(console, "warn").mockImplementation(() => {}) // Suppress console.warn

			const result = await vectorStore.initialize()

			// Should still return true since main collection setup succeeded
			expect(result).toBe(true)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledTimes(1)

			// Verify all payload index creations were attempted
			expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledTimes(5)

			// Verify warnings were logged for each failed index
			expect(console.warn).toHaveBeenCalledTimes(5)
			for (let i = 0; i <= 4; i++) {
				expect(console.warn).toHaveBeenCalledWith(
					expect.stringContaining(`Could not create payload index for pathSegments.${i}`),
					indexError.message,
				)
			}

			;(console.warn as any).mockRestore()
		})

		it("should throw vectorDimensionMismatch error when deleteCollection fails during recreation", async () => {
			const differentVectorSize = 768
			mockQdrantClientInstance.getCollection.mockResolvedValue({
				config: {
					params: {
						vectors: {
							size: differentVectorSize,
						},
					},
				},
			} as any)

			const deleteError = new Error("Delete Collection Failed")
			mockQdrantClientInstance.deleteCollection.mockRejectedValue(deleteError)
			vitest.spyOn(console, "error").mockImplementation(() => {})
			vitest.spyOn(console, "warn").mockImplementation(() => {})

			// The error should have a cause property set to the original error
			let caughtError: any
			try {
				await vectorStore.initialize()
			} catch (error: any) {
				caughtError = error
			}

			expect(caughtError).toBeDefined()
			expect(caughtError.message).toContain("Failed to update vector index for new model")
			expect(caughtError.cause).toBe(deleteError)

			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).not.toHaveBeenCalled()
			expect(mockQdrantClientInstance.createPayloadIndex).not.toHaveBeenCalled()
			// Should log both the warning and the critical error
			expect(console.warn).toHaveBeenCalledTimes(1)
			expect(console.error).toHaveBeenCalledTimes(2) // One for the critical error, one for the outer catch
			;(console.error as any).mockRestore()
			;(console.warn as any).mockRestore()
		})

		it("should throw vectorDimensionMismatch error when createCollection fails during recreation", async () => {
			const differentVectorSize = 768
			mockQdrantClientInstance.getCollection
				.mockResolvedValueOnce({
					config: {
						params: {
							vectors: {
								size: differentVectorSize,
							},
						},
					},
				} as any)
				// Second call should return 404 to confirm deletion
				.mockRejectedValueOnce({
					response: { status: 404 },
					message: "Not found",
				})

			// Delete succeeds but create fails
			mockQdrantClientInstance.deleteCollection.mockResolvedValue(true as any)
			const createError = new Error("Create Collection Failed")
			mockQdrantClientInstance.createCollection.mockRejectedValue(createError)
			vitest.spyOn(console, "error").mockImplementation(() => {})
			vitest.spyOn(console, "warn").mockImplementation(() => {})

			// Should throw an error with cause property set to the original error
			let caughtError: any
			try {
				await vectorStore.initialize()
			} catch (error: any) {
				caughtError = error
			}

			expect(caughtError).toBeDefined()
			expect(caughtError.message).toContain("Failed to update vector index for new model")
			expect(caughtError.cause).toBe(createError)

			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(2)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createPayloadIndex).not.toHaveBeenCalled()
			// Should log warning, critical error, and outer error
			expect(console.warn).toHaveBeenCalledTimes(1)
			expect(console.error).toHaveBeenCalledTimes(2)
			;(console.error as any).mockRestore()
			;(console.warn as any).mockRestore()
		})

		it("should verify collection deletion before proceeding with recreation", async () => {
			const differentVectorSize = 768
			mockQdrantClientInstance.getCollection
				.mockResolvedValueOnce({
					config: {
						params: {
							vectors: {
								size: differentVectorSize,
							},
						},
					},
				} as any)
				// Second call should return 404 to confirm deletion
				.mockRejectedValueOnce({
					response: { status: 404 },
					message: "Not found",
				})

			mockQdrantClientInstance.deleteCollection.mockResolvedValue(true as any)
			mockQdrantClientInstance.createCollection.mockResolvedValue(true as any)
			mockQdrantClientInstance.createPayloadIndex.mockResolvedValue({} as any)
			vitest.spyOn(console, "warn").mockImplementation(() => {})

			const result = await vectorStore.initialize()

			expect(result).toBe(true)
			// Should call getCollection twice: once to check existing, once to verify deletion
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(2)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledTimes(5)
			;(console.warn as any).mockRestore()
		})

		it("should throw error if collection still exists after deletion attempt", async () => {
			const differentVectorSize = 768
			mockQdrantClientInstance.getCollection
				.mockResolvedValueOnce({
					config: {
						params: {
							vectors: {
								size: differentVectorSize,
							},
						},
					},
				} as any)
				// Second call should still return the collection (deletion failed)
				.mockResolvedValueOnce({
					config: {
						params: {
							vectors: {
								size: differentVectorSize,
							},
						},
					},
				} as any)

			mockQdrantClientInstance.deleteCollection.mockResolvedValue(true as any)
			vitest.spyOn(console, "error").mockImplementation(() => {})
			vitest.spyOn(console, "warn").mockImplementation(() => {})

			let caughtError: any
			try {
				await vectorStore.initialize()
			} catch (error: any) {
				caughtError = error
			}

			expect(caughtError).toBeDefined()
			expect(caughtError.message).toContain("Failed to update vector index for new model")
			// The error message should contain the contextual error details
			expect(caughtError.message).toContain("Deleted existing collection but failed verification step")

			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(2)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).not.toHaveBeenCalled()
			expect(mockQdrantClientInstance.createPayloadIndex).not.toHaveBeenCalled()
			;(console.error as any).mockRestore()
			;(console.warn as any).mockRestore()
		})

		it("should handle dimension mismatch scenario from 2048 to 768 dimensions", async () => {
			// Simulate the exact scenario from the issue: switching from 2048 to 768 dimensions
			const oldVectorSize = 2048
			const newVectorSize = 768

			// Create a new vector store with the new dimension
			const newVectorStore = new QdrantVectorStore(mockWorkspacePath, mockQdrantUrl, newVectorSize, mockApiKey)

			mockQdrantClientInstance.getCollection
				.mockResolvedValueOnce({
					config: {
						params: {
							vectors: {
								size: oldVectorSize, // Existing collection has 2048 dimensions
							},
						},
					},
				} as any)
				// Second call should return 404 to confirm deletion
				.mockRejectedValueOnce({
					response: { status: 404 },
					message: "Not found",
				})

			mockQdrantClientInstance.deleteCollection.mockResolvedValue(true as any)
			mockQdrantClientInstance.createCollection.mockResolvedValue(true as any)
			mockQdrantClientInstance.createPayloadIndex.mockResolvedValue({} as any)
			vitest.spyOn(console, "warn").mockImplementation(() => {})

			const result = await newVectorStore.initialize()

			expect(result).toBe(true)
			expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(2)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.createCollection).toHaveBeenCalledWith(expectedCollectionName, {
				vectors: {
					size: newVectorSize, // Should create with new 768 dimensions
					distance: "Cosine",
				},
			})
			expect(mockQdrantClientInstance.createPayloadIndex).toHaveBeenCalledTimes(5)
			;(console.warn as any).mockRestore()
		})

		it("should provide detailed error context for different failure scenarios", async () => {
			const differentVectorSize = 768
			mockQdrantClientInstance.getCollection.mockResolvedValue({
				config: {
					params: {
						vectors: {
							size: differentVectorSize,
						},
					},
				},
			} as any)

			// Test deletion failure with specific error message
			const deleteError = new Error("Qdrant server unavailable")
			mockQdrantClientInstance.deleteCollection.mockRejectedValue(deleteError)
			vitest.spyOn(console, "error").mockImplementation(() => {})
			vitest.spyOn(console, "warn").mockImplementation(() => {})

			let caughtError: any
			try {
				await vectorStore.initialize()
			} catch (error: any) {
				caughtError = error
			}

			expect(caughtError).toBeDefined()
			expect(caughtError.message).toContain("Failed to update vector index for new model")
			// The error message should contain the contextual error details
			expect(caughtError.message).toContain("Failed to delete existing collection with vector size")
			expect(caughtError.message).toContain("Qdrant server unavailable")
			expect(caughtError.cause).toBe(deleteError)
			;(console.error as any).mockRestore()
			;(console.warn as any).mockRestore()
		})
	})

	it("should return true when collection exists", async () => {
		mockQdrantClientInstance.getCollection.mockResolvedValue({
			config: {
				/* collection data */
			},
		} as any)

		const result = await vectorStore.collectionExists()

		expect(result).toBe(true)
		expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
		expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledWith(expectedCollectionName)
	})

	it("should return false when collection does not exist (404 error)", async () => {
		mockQdrantClientInstance.getCollection.mockRejectedValue({
			response: { status: 404 },
			message: "Not found",
		})

		const result = await vectorStore.collectionExists()

		expect(result).toBe(false)
		expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
		expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledWith(expectedCollectionName)
	})

	it("should return false and log warning for non-404 errors", async () => {
		const genericError = new Error("Network error")
		mockQdrantClientInstance.getCollection.mockRejectedValue(genericError)
		vitest.spyOn(console, "warn").mockImplementation(() => {})

		const result = await vectorStore.collectionExists()

		expect(result).toBe(false)
		expect(mockQdrantClientInstance.getCollection).toHaveBeenCalledTimes(1)
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining(`Warning during getCollectionInfo for "${expectedCollectionName}"`),
			genericError.message,
		)
		;(console.warn as any).mockRestore()
	})
	describe("deleteCollection", () => {
		it("should delete collection when it exists", async () => {
			// Mock collectionExists to return true
			vitest.spyOn(vectorStore, "collectionExists").mockResolvedValue(true)
			mockQdrantClientInstance.deleteCollection.mockResolvedValue(true as any)

			await vectorStore.deleteCollection()

			expect(vectorStore.collectionExists).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledWith(expectedCollectionName)
		})

		it("should not attempt to delete collection when it does not exist", async () => {
			// Mock collectionExists to return false
			vitest.spyOn(vectorStore, "collectionExists").mockResolvedValue(false)

			await vectorStore.deleteCollection()

			expect(vectorStore.collectionExists).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).not.toHaveBeenCalled()
		})

		it("should log and re-throw error when deletion fails", async () => {
			vitest.spyOn(vectorStore, "collectionExists").mockResolvedValue(true)
			const deleteError = new Error("Deletion failed")
			mockQdrantClientInstance.deleteCollection.mockRejectedValue(deleteError)
			vitest.spyOn(console, "error").mockImplementation(() => {})

			await expect(vectorStore.deleteCollection()).rejects.toThrow(deleteError)

			expect(vectorStore.collectionExists).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.deleteCollection).toHaveBeenCalledTimes(1)
			expect(console.error).toHaveBeenCalledWith(
				`[QdrantVectorStore] Failed to delete collection ${expectedCollectionName}:`,
				deleteError,
			)
			;(console.error as any).mockRestore()
		})
	})

	describe("upsertPoints", () => {
		it("should correctly call qdrantClient.upsert with processed points", async () => {
			const mockPoints = [
				{
					id: "test-id-1",
					vector: [0.1, 0.2, 0.3],
					payload: {
						filePath: "src/components/Button.tsx",
						content: "export const Button = () => {}",
						startLine: 1,
						endLine: 3,
					},
				},
				{
					id: "test-id-2",
					vector: [0.4, 0.5, 0.6],
					payload: {
						filePath: "src/utils/helpers.ts",
						content: "export function helper() {}",
						startLine: 5,
						endLine: 7,
					},
				},
			]

			mockQdrantClientInstance.upsert.mockResolvedValue({} as any)

			await vectorStore.upsertPoints(mockPoints)

			expect(mockQdrantClientInstance.upsert).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.upsert).toHaveBeenCalledWith(expectedCollectionName, {
				points: [
					{
						id: "test-id-1",
						vector: [0.1, 0.2, 0.3],
						payload: {
							filePath: "src/components/Button.tsx",
							content: "export const Button = () => {}",
							startLine: 1,
							endLine: 3,
							pathSegments: {
								"0": "src",
								"1": "components",
								"2": "Button.tsx",
							},
						},
					},
					{
						id: "test-id-2",
						vector: [0.4, 0.5, 0.6],
						payload: {
							filePath: "src/utils/helpers.ts",
							content: "export function helper() {}",
							startLine: 5,
							endLine: 7,
							pathSegments: {
								"0": "src",
								"1": "utils",
								"2": "helpers.ts",
							},
						},
					},
				],
				wait: true,
			})
		})

		it("should handle points without filePath in payload", async () => {
			const mockPoints = [
				{
					id: "test-id-1",
					vector: [0.1, 0.2, 0.3],
					payload: {
						content: "some content without filePath",
						startLine: 1,
						endLine: 3,
					},
				},
			]

			mockQdrantClientInstance.upsert.mockResolvedValue({} as any)

			await vectorStore.upsertPoints(mockPoints)

			expect(mockQdrantClientInstance.upsert).toHaveBeenCalledWith(expectedCollectionName, {
				points: [
					{
						id: "test-id-1",
						vector: [0.1, 0.2, 0.3],
						payload: {
							content: "some content without filePath",
							startLine: 1,
							endLine: 3,
						},
					},
				],
				wait: true,
			})
		})

		it("should handle empty input arrays", async () => {
			mockQdrantClientInstance.upsert.mockResolvedValue({} as any)

			await vectorStore.upsertPoints([])

			expect(mockQdrantClientInstance.upsert).toHaveBeenCalledWith(expectedCollectionName, {
				points: [],
				wait: true,
			})
		})

		it("should correctly process pathSegments for nested file paths", async () => {
			const mockPoints = [
				{
					id: "test-id-1",
					vector: [0.1, 0.2, 0.3],
					payload: {
						filePath: "src/components/ui/forms/InputField.tsx",
						content: "export const InputField = () => {}",
						startLine: 1,
						endLine: 3,
					},
				},
			]

			mockQdrantClientInstance.upsert.mockResolvedValue({} as any)

			await vectorStore.upsertPoints(mockPoints)

			expect(mockQdrantClientInstance.upsert).toHaveBeenCalledWith(expectedCollectionName, {
				points: [
					{
						id: "test-id-1",
						vector: [0.1, 0.2, 0.3],
						payload: {
							filePath: "src/components/ui/forms/InputField.tsx",
							content: "export const InputField = () => {}",
							startLine: 1,
							endLine: 3,
							pathSegments: {
								"0": "src",
								"1": "components",
								"2": "ui",
								"3": "forms",
								"4": "InputField.tsx",
							},
						},
					},
				],
				wait: true,
			})
		})

		it("should handle error scenarios when qdrantClient.upsert fails", async () => {
			const mockPoints = [
				{
					id: "test-id-1",
					vector: [0.1, 0.2, 0.3],
					payload: {
						filePath: "src/test.ts",
						content: "test content",
						startLine: 1,
						endLine: 1,
					},
				},
			]

			const upsertError = new Error("Upsert failed")
			mockQdrantClientInstance.upsert.mockRejectedValue(upsertError)
			vitest.spyOn(console, "error").mockImplementation(() => {})

			await expect(vectorStore.upsertPoints(mockPoints)).rejects.toThrow(upsertError)

			expect(mockQdrantClientInstance.upsert).toHaveBeenCalledTimes(1)
			expect(console.error).toHaveBeenCalledWith("Failed to upsert points:", upsertError)
			;(console.error as any).mockRestore()
		})
	})

	describe("search", () => {
		it("should correctly call qdrantClient.query and transform results", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const mockQdrantResults = {
				points: [
					{
						id: "test-id-1",
						score: 0.85,
						payload: {
							filePath: "src/test.ts",
							codeChunk: "test code",
							startLine: 1,
							endLine: 5,
							pathSegments: { "0": "src", "1": "test.ts" },
						},
					},
					{
						id: "test-id-2",
						score: 0.75,
						payload: {
							filePath: "src/utils.ts",
							codeChunk: "utility code",
							startLine: 10,
							endLine: 15,
							pathSegments: { "0": "src", "1": "utils.ts" },
						},
					},
				],
			}

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			const results = await vectorStore.search(queryVector)

			expect(mockQdrantClientInstance.query).toHaveBeenCalledTimes(1)
			expect(mockQdrantClientInstance.query).toHaveBeenCalledWith(expectedCollectionName, {
				query: queryVector,
				filter: undefined,
				score_threshold: DEFAULT_SEARCH_MIN_SCORE,
				limit: DEFAULT_MAX_SEARCH_RESULTS,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
				},
			})

			expect(results).toEqual(mockQdrantResults.points)
		})

		it("should apply filePathPrefix filter correctly", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const directoryPrefix = "src/components"
			const mockQdrantResults = {
				points: [
					{
						id: "test-id-1",
						score: 0.85,
						payload: {
							filePath: "src/components/Button.tsx",
							codeChunk: "button code",
							startLine: 1,
							endLine: 5,
							pathSegments: { "0": "src", "1": "components", "2": "Button.tsx" },
						},
					},
				],
			}

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			const results = await vectorStore.search(queryVector, directoryPrefix)

			expect(mockQdrantClientInstance.query).toHaveBeenCalledWith(expectedCollectionName, {
				query: queryVector,
				filter: {
					must: [
						{
							key: "pathSegments.0",
							match: { value: "src" },
						},
						{
							key: "pathSegments.1",
							match: { value: "components" },
						},
					],
				},
				score_threshold: DEFAULT_SEARCH_MIN_SCORE,
				limit: DEFAULT_MAX_SEARCH_RESULTS,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
				},
			})

			expect(results).toEqual(mockQdrantResults.points)
		})

		it("should use custom minScore when provided", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const customMinScore = 0.8
			const mockQdrantResults = { points: [] }

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			await vectorStore.search(queryVector, undefined, customMinScore)

			expect(mockQdrantClientInstance.query).toHaveBeenCalledWith(expectedCollectionName, {
				query: queryVector,
				filter: undefined,
				score_threshold: customMinScore,
				limit: DEFAULT_MAX_SEARCH_RESULTS,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
				},
			})
		})

		it("should use custom maxResults when provided", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const customMaxResults = 100
			const mockQdrantResults = { points: [] }

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			await vectorStore.search(queryVector, undefined, undefined, customMaxResults)

			expect(mockQdrantClientInstance.query).toHaveBeenCalledWith(expectedCollectionName, {
				query: queryVector,
				filter: undefined,
				score_threshold: DEFAULT_SEARCH_MIN_SCORE,
				limit: customMaxResults,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
				},
			})
		})

		it("should filter out results with invalid payloads", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const mockQdrantResults = {
				points: [
					{
						id: "valid-result",
						score: 0.85,
						payload: {
							filePath: "src/test.ts",
							codeChunk: "test code",
							startLine: 1,
							endLine: 5,
						},
					},
					{
						id: "invalid-result-1",
						score: 0.75,
						payload: {
							// Missing required fields
							filePath: "src/invalid.ts",
						},
					},
					{
						id: "valid-result-2",
						score: 0.55,
						payload: {
							filePath: "src/test2.ts",
							codeChunk: "test code 2",
							startLine: 10,
							endLine: 15,
						},
					},
				],
			}

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			const results = await vectorStore.search(queryVector)

			// Should only return results with valid payloads
			expect(results).toHaveLength(2)
			expect(results[0].id).toBe("valid-result")
			expect(results[1].id).toBe("valid-result-2")
		})

		it("should filter out results with null or undefined payloads", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const mockQdrantResults = {
				points: [
					{
						id: "valid-result",
						score: 0.85,
						payload: {
							filePath: "src/test.ts",
							codeChunk: "test code",
							startLine: 1,
							endLine: 5,
						},
					},
					{
						id: "null-payload-result",
						score: 0.75,
						payload: null,
					},
					{
						id: "undefined-payload-result",
						score: 0.65,
						payload: undefined,
					},
					{
						id: "valid-result-2",
						score: 0.55,
						payload: {
							filePath: "src/test2.ts",
							codeChunk: "test code 2",
							startLine: 10,
							endLine: 15,
						},
					},
				],
			}

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			const results = await vectorStore.search(queryVector)

			// Should only return results with valid payloads, filtering out null and undefined
			expect(results).toHaveLength(2)
			expect(results[0].id).toBe("valid-result")
			expect(results[1].id).toBe("valid-result-2")
		})

		it("should handle scenarios where no results are found", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const mockQdrantResults = { points: [] }

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			const results = await vectorStore.search(queryVector)

			expect(mockQdrantClientInstance.query).toHaveBeenCalledTimes(1)
			expect(results).toEqual([])
		})

		it("should handle complex directory prefix with multiple segments", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const directoryPrefix = "src/components/ui/forms"
			const mockQdrantResults = { points: [] }

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			await vectorStore.search(queryVector, directoryPrefix)

			expect(mockQdrantClientInstance.query).toHaveBeenCalledWith(expectedCollectionName, {
				query: queryVector,
				filter: {
					must: [
						{
							key: "pathSegments.0",
							match: { value: "src" },
						},
						{
							key: "pathSegments.1",
							match: { value: "components" },
						},
						{
							key: "pathSegments.2",
							match: { value: "ui" },
						},
						{
							key: "pathSegments.3",
							match: { value: "forms" },
						},
					],
				},
				score_threshold: DEFAULT_SEARCH_MIN_SCORE,
				limit: DEFAULT_MAX_SEARCH_RESULTS,
				params: {
					hnsw_ef: 128,
					exact: false,
				},
				with_payload: {
					include: ["filePath", "codeChunk", "startLine", "endLine", "pathSegments"],
				},
			})
		})

		it("should handle error scenarios when qdrantClient.query fails", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const queryError = new Error("Query failed")
			mockQdrantClientInstance.query.mockRejectedValue(queryError)
			vitest.spyOn(console, "error").mockImplementation(() => {})

			await expect(vectorStore.search(queryVector)).rejects.toThrow(queryError)

			expect(mockQdrantClientInstance.query).toHaveBeenCalledTimes(1)
			expect(console.error).toHaveBeenCalledWith("Failed to search points:", queryError)
			;(console.error as any).mockRestore()
		})

		it("should use constants DEFAULT_MAX_SEARCH_RESULTS and DEFAULT_SEARCH_MIN_SCORE correctly", async () => {
			const queryVector = [0.1, 0.2, 0.3]
			const mockQdrantResults = { points: [] }

			mockQdrantClientInstance.query.mockResolvedValue(mockQdrantResults)

			await vectorStore.search(queryVector)

			const callArgs = mockQdrantClientInstance.query.mock.calls[0][1]
			expect(callArgs.limit).toBe(DEFAULT_MAX_SEARCH_RESULTS)
			expect(callArgs.score_threshold).toBe(DEFAULT_SEARCH_MIN_SCORE)
		})
	})
})

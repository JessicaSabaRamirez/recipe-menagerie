import { useState } from 'react';
import { analyzeImage, saveRecipe } from './api';

export default function RecipeUpload({ onSaved }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setDraft(null);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const data = await analyzeImage(file);
      setDraft(data);
    } catch (err) {
      alert("Failed to analyze recipe. See console.");
      console.error(err);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await saveRecipe(draft, file);
      alert("Recipe saved!");
      setFile(null);
      setPreview(null);
      setDraft(null);
      if (onSaved) onSaved(); // Refresh list
    } catch (err) {
      alert("Error saving.");
    }
    setLoading(false);
  };

  // Helper to update nested state for Source
  const updateSource = (field, val) => {
    setDraft({ ...draft, source: { ...draft.source, [field]: val } });
  };

  return (
    <div className="p-4 border rounded shadow bg-white no-print">
      <h2 className="text-xl font-bold mb-4">Add New Recipe</h2>
      
      {/* File Input */}
      <input type="file" accept="image/*" onChange={handleFileChange} className="mb-2" />
      
      {preview && (
        <img src={preview} alt="Preview" className="w-full max-h-64 object-contain mb-4 rounded" />
      )}

      {/* Analyze Button */}
      {file && !draft && (
        <button 
          onClick={handleAnalyze} 
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 w-full"
        >
          {loading ? "Analyzing with AI..." : "Extract Recipe"}
        </button>
      )}

      {/* Editor Form */}
      {draft && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-sm font-bold">Title</label>
            <input 
              value={draft.title} 
              onChange={(e) => setDraft({...draft, title: e.target.value})}
              className="w-full border p-2 rounded"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-bold">Source Title</label>
              <input 
                value={draft.source?.title || ''} 
                onChange={(e) => updateSource('title', e.target.value)}
                className="w-full border p-2 rounded"
                placeholder="e.g. Joy of Cooking"
              />
            </div>
            <div>
              <label className="block text-sm font-bold">Page</label>
              <input 
                value={draft.source?.page || ''} 
                onChange={(e) => updateSource('page', e.target.value)}
                className="w-full border p-2 rounded"
                type="number"
              />
            </div>
          </div>

          <div>
             <label className="block text-sm font-bold">Ingredients (comma separated)</label>
             <textarea 
               value={draft.ingredients.join(', ')} 
               onChange={(e) => setDraft({...draft, ingredients: e.target.value.split(', ')})}
               className="w-full border p-2 rounded h-24"
             />
          </div>

          <button 
            onClick={handleSave}
            disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 w-full font-bold"
          >
            {loading ? "Saving..." : "Save to Cookbook"}
          </button>
        </div>
      )}
    </div>
  );
}
